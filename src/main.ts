import { readFileSync } from "fs";
import * as core from "@actions/core";
import OpenAI from "openai";
import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import minimatch from "minimatch";

// Configuration can come from GitHub Actions or environment variables
export function getConfig() {
  const isGitHubAction = !!process.env.GITHUB_ACTIONS;

  return {
    GITHUB_TOKEN: isGitHubAction ? core.getInput("GITHUB_TOKEN") : process.env.GITHUB_TOKEN,
    AI_PROVIDER: isGitHubAction ? core.getInput("AI_PROVIDER") : process.env.AI_PROVIDER || 'openai',
    OPENAI_API_KEY: isGitHubAction ? core.getInput("OPENAI_API_KEY") : process.env.OPENAI_API_KEY,
    OPENAI_API_MODEL: isGitHubAction ? core.getInput("OPENAI_API_MODEL") : process.env.OPENAI_API_MODEL || 'gpt-4',
    ANTHROPIC_API_KEY: isGitHubAction ? core.getInput("ANTHROPIC_API_KEY") : process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_API_MODEL: isGitHubAction ? core.getInput("ANTHROPIC_API_MODEL") : process.env.ANTHROPIC_API_MODEL || 'claude-3-5-sonnet-20241022',
    role: isGitHubAction ? core.getInput("role") : process.env.ROLE || 'Senior Software Engineer',
    tech_stack: isGitHubAction ? core.getInput("tech_stack") : process.env.TECH_STACK || 'TypeScript, JavaScript, Node.js',
    prIgnore: isGitHubAction 
      ? core.getMultilineInput("pr_ignore").map(customPrompt => `- ${customPrompt}`).join("\n")
      : (process.env.PR_IGNORE || '').split(',').map(line => `- ${line.trim()}`).join('\n')
  };
}

const config = getConfig();

// Validate API keys based on provider
if (config.AI_PROVIDER === 'openai' && !config.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required when using OpenAI provider');
}
if (config.AI_PROVIDER === 'anthropic' && !config.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is required when using Anthropic provider');
}

export const octokit = new Octokit({ auth: config.GITHUB_TOKEN });

export const openai = config.AI_PROVIDER === 'openai' ? new OpenAI({
  apiKey: config.OPENAI_API_KEY,
}) : null;

export const anthropic = config.AI_PROVIDER === 'anthropic' ? new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
}) : null;

export interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

export async function getPRDetails(prUrl?: string): Promise<PRDetails> {
  if (prUrl) {
    // Parse PR URL format: https://github.com/owner/repo/pull/number
    const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) {
      throw new Error('Invalid GitHub PR URL. Format should be: https://github.com/owner/repo/pull/number');
    }
    const [, owner, repo, pullNumber] = match;
    const prResponse = await octokit.pulls.get({
      owner,
      repo,
      pull_number: parseInt(pullNumber, 10),
    });
    return {
      owner,
      repo,
      pull_number: parseInt(pullNumber, 10),
      title: prResponse.data.title ?? "",
      description: prResponse.data.body ?? "",
    };
  } else {
    // GitHub Actions context
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error('GITHUB_EVENT_PATH environment variable is not set');
    }
    const { repository, number } = JSON.parse(
      readFileSync(eventPath, "utf8")
    );
    const prResponse = await octokit.pulls.get({
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: number,
    });
    return {
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: number,
      title: prResponse.data.title ?? "",
      description: prResponse.data.body ?? "",
    };
  }
}

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });
    
    // @ts-expect-error - response.data can be an array or an object
    if (response.data.content) {
      // Content is base64 encoded
      // @ts-expect-error - response.data can be an array or an object
      return Buffer.from(response.data.content, 'base64').toString();
    }
    return null;
  } catch (error) {
    console.error(`Error getting file content: ${error}`);
    return null;
  }
}

export async function getDiff(
  owner: string,
  repo: string,
  pull_number: number
): Promise<string | null> {
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  // @ts-expect-error - response.data is a string
  return response.data;
}

export async function analyzeCode(
  parsedDiff: File[],
  prDetails: PRDetails,
  prIgnore: string
): Promise<Array<{ body: string; path: string; line: number }>> {
  const comments: Array<{ body: string; path: string; line: number }> = [];

  for (const file of parsedDiff) {
    if (file.to === "/dev/null") continue; // Ignore deleted files
    
    // Get the full file content
    const fileContent = await getFileContent(
      prDetails.owner,
      prDetails.repo,
      file.to!,
      `pull/${prDetails.pull_number}/head`
    );

    for (const chunk of file.chunks) {
      const prompt = createPrompt(file, chunk, prDetails, prIgnore, fileContent);
      const aiResponse = await getAIResponse(prompt);
      if (aiResponse) {
        const newComments = createComment(file, chunk, aiResponse);
        if (newComments) {
          comments.push(...newComments);
        }
      }
    }
  }
  return comments;
}

export function createPrompt(
  file: File, 
  chunk: Chunk, 
  prDetails: PRDetails, 
  prIgnore: string,
  fullFileContent: string | null
): string {
  // Sanitize inputs to prevent control characters
  const sanitizeText = (text: string) => text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  
  const sanitizedTitle = sanitizeText(prDetails.title);
  const sanitizedDescription = sanitizeText(prDetails.description);
  const sanitizedContent = chunk.content ? sanitizeText(chunk.content) : '';
  const sanitizedFileContent = fullFileContent ? sanitizeText(fullFileContent) : 'File content not available';
  const sanitizedFilePath = file.to ? sanitizeText(file.to) : '';
  
  // Sanitize all user-provided inputs
  const sanitizedRole = sanitizeText(config.role);
  const sanitizedTechStack = sanitizeText(config.tech_stack);
  const sanitizedPrIgnore = sanitizeText(prIgnore);
  
  return [
    `You are a ${sanitizedRole}. Your task is to review pull requests. Project's tech stack is ${sanitizedTechStack}.`,
    'Instructions:',
    '- Do not wrap the json codes in JSON markers',
    '- Provide the response in following JSON format: {"reviews": [{"lineNumber": <line_number>, "reviewComment": "<review comment>"}]}',
    '- Do not give positive comments or compliments.',
    '- If suggestion has similar changes already in the code, don\'t mention that.',
    '- Provide comments and suggestions ONLY if there is something to improve, otherwise "reviews" should be an empty array.',
    '- Write the comment in GitHub Markdown format.',
    '- Use the given description only for the overall context and only comment the code.',
    '- IMPORTANT: NEVER suggest adding comments to the code.',
    '',
    'Ignore these items from the PR:',
    sanitizedPrIgnore,
    '',
    `Review the following code diff in the file "${sanitizedFilePath}" and take the pull request title and description into account when writing the response.`,
    '',
    `Pull request title: ${sanitizedTitle}`,
    'Pull request description:',
    '---',
    sanitizedDescription,
    '---',
    '',
    'Git diff to review:',
    '```diff',
    sanitizedContent,
    chunk.changes
      // @ts-expect-error - ln and ln2 exists where needed
      .map((c) => sanitizeText(`${c.ln ? c.ln : c.ln2} ${c.content}`))
      .join('\n'),
    '```',
    '',
    'Full file content:',
    '```',
    sanitizedFileContent.length > 10000 
      ? `${sanitizedFileContent.slice(0, 5000)}\n... (content truncated) ...\n${sanitizedFileContent.slice(-5000)}`
      : sanitizedFileContent,
    '```'
  ].join('\n');
}

export async function getAIResponse(prompt: string): Promise<Array<{
  lineNumber: string;
  reviewComment: string;
}> | null> {
  try {
    if (config.AI_PROVIDER === 'openai' && openai) {
      const queryConfig = {
        model: config.OPENAI_API_MODEL,
        temperature: 0.2,
        max_tokens: 700,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      };

      const response = await openai.chat.completions.create({
        ...queryConfig,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: prompt,
          },
        ],
      });

      const res = response.choices[0].message?.content?.trim() || "{}";
      let jsonStr = res;
      if (res.startsWith("```json")) {
        // Remove the markdown code block markers and any trailing whitespace
        jsonStr = res.replace(/^```json\s*/, '').replace(/\s*```\s*$/, '');
      }
      return JSON.parse(jsonStr).reviews;
    } else if (config.AI_PROVIDER === 'anthropic' && anthropic) {
      const response = await anthropic.messages.create({
        model: config.ANTHROPIC_API_MODEL,
        max_tokens: 1024,
        temperature: 0.2,
        messages: [
          {
            "role": "user", 
            "content": prompt
          }
        ],
      });

      // Handle Anthropic's response format
      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Anthropic API');
      }

      const res = content.text.trim();
      let jsonStr = res;
      if (res.startsWith("```json")) {
        // Remove the markdown code block markers and any trailing whitespace
        jsonStr = res.replace(/^```json\s*/, '').replace(/\s*```\s*$/, '');
      }
      return JSON.parse(jsonStr).reviews;
    } else {
      throw new Error(`Invalid AI provider: ${config.AI_PROVIDER}`);
    }
  } catch (error) {
    console.error("Error:", error);
    return null;
  }
}

export function createComment(
  file: File,
  chunk: Chunk,
  aiResponses: Array<{
    lineNumber: string;
    reviewComment: string;
  }>
): Array<{ body: string; path: string; line: number }> {
  return aiResponses.flatMap((aiResponse) => {
    if (!file.to) {
      return [];
    }
    // Sanitize file path and review comment
    const sanitizeText = (text: string) => text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    const sanitizedPath = sanitizeText(file.to);
    const sanitizedComment = sanitizeText(aiResponse.reviewComment);
    return {
      body: sanitizedComment,
      path: sanitizedPath,
      line: Number(aiResponse.lineNumber),
    };
  });
}

export async function createReviewComment(
  owner: string,
  repo: string,
  pull_number: number,
  comments: Array<{ body: string; path: string; line: number }>
): Promise<void> {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    comments,
    event: "COMMENT",
  });
}

// Only run main when executed directly (not imported)
if (require.main === module) {
  async function main() {
    const prDetails = await getPRDetails();
    let diff: string | null;
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error('GITHUB_EVENT_PATH environment variable is not set');
    }
    const eventData = JSON.parse(
      readFileSync(eventPath, "utf8")
    );

    if (eventData.action === "opened") {
      diff = await getDiff(
        prDetails.owner,
        prDetails.repo,
        prDetails.pull_number
      );
    } else if (eventData.action === "review_requested") {
      diff = await getDiff(
        prDetails.owner,
        prDetails.repo,
        prDetails.pull_number
      );
    } else if (eventData.action === "synchronize") {
      const newBaseSha = eventData.before;
      const newHeadSha = eventData.after;

      const response = await octokit.repos.compareCommits({
        headers: {
          accept: "application/vnd.github.v3.diff",
        },
        owner: prDetails.owner,
        repo: prDetails.repo,
        base: newBaseSha,
        head: newHeadSha,
      });

      diff = String(response.data);
    } else {
      console.log("Unsupported event:", process.env.GITHUB_EVENT_NAME);
      return;
    }

    if (!diff) {
      console.log("No diff found");
      return;
    }

    const parsedDiff = parseDiff(diff);

    const excludePatterns = core
      .getInput("exclude")
      .split(",")
      .map((s) => s.trim());

    const filteredDiff = parsedDiff.filter((file) => {
      return !excludePatterns.some((pattern) =>
        minimatch(file.to ?? "", pattern)
      );
    });

    const comments = await analyzeCode(filteredDiff, prDetails, config.prIgnore);
    if (comments.length > 0) {
      await createReviewComment(
        prDetails.owner,
        prDetails.repo,
        prDetails.pull_number,
        comments
      );
    }
  }

  main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
