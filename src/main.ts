import { readFileSync } from "fs";
import * as core from "@actions/core";
import OpenAI from "openai";
import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import minimatch from "minimatch";

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const AI_PROVIDER: string = core.getInput("AI_PROVIDER");
const OPENAI_API_KEY: string = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL: string = core.getInput("OPENAI_API_MODEL");
const ANTHROPIC_API_KEY: string = core.getInput("ANTHROPIC_API_KEY");
const ANTHROPIC_API_MODEL: string = core.getInput("ANTHROPIC_API_MODEL");
const role: string = core.getInput("role");
const tech_stack: string = core.getInput("tech_stack");
const prIgnore: string = core.getMultilineInput("pr_ignore").map(customPrompt => `- ${customPrompt}`).join("\n")

// Validate API keys based on provider
if (AI_PROVIDER === 'openai' && !OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required when using OpenAI provider');
}
if (AI_PROVIDER === 'anthropic' && !ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is required when using Anthropic provider');
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const openai = AI_PROVIDER === 'openai' ? new OpenAI({
  apiKey: OPENAI_API_KEY,
}) : null;

const anthropic = AI_PROVIDER === 'anthropic' ? new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
}) : null;

interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

async function getPRDetails(): Promise<PRDetails> {
  const { repository, number } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")
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

async function getFileContent(
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

async function getDiff(
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

async function analyzeCode(
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

function createPrompt(
  file: File, 
  chunk: Chunk, 
  prDetails: PRDetails, 
  prIgnore: string,
  fullFileContent: string | null
): string {
  return `You are a ${role}. Your task is to review pull requests. Project's tech stack is ${tech_stack}.
  Instructions:
- Do not wrap the json codes in JSON markers
- Provide the response in following JSON format:  {"reviews": [{"lineNumber":  <line_number>, "reviewComment": "<review comment>"}]}
- Do not give positive comments or compliments.
- If suggestion has similar changes already in the code, don't mention that.
- Provide comments and suggestions ONLY if there is something to improve, otherwise "reviews" should be an empty array.
- Write the comment in GitHub Markdown format.
- Use the given description only for the overall context and only comment the code.
- IMPORTANT: NEVER suggest adding comments to the code.

Ignore these items from the PR:
${prIgnore}

Review the following code diff in the file "${
    file.to
  }" and take the pull request title and description into account when writing the response.
  
Pull request title: ${prDetails.title}
Pull request description:

---
${prDetails.description}
---

Git diff to review:

\`\`\`diff
${chunk.content}
${chunk.changes
  // @ts-expect-error - ln and ln2 exists where needed
  .map((c) => `${c.ln ? c.ln : c.ln2} ${c.content}`)
  .join("\n")}
\`\`\`


Full file content:
\`\`\`
${fullFileContent ? (fullFileContent.length > 10000 ? 
  fullFileContent.slice(0, 5000) + '\n... (content truncated) ...\n' + fullFileContent.slice(-5000) 
  : fullFileContent) 
  : 'File content not available'}
\`\`\`

`;
}

async function getAIResponse(prompt: string): Promise<Array<{
  lineNumber: string;
  reviewComment: string;
}> | null> {
  try {
    if (AI_PROVIDER === 'openai' && openai) {
      const queryConfig = {
        model: OPENAI_API_MODEL,
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
      if (res.startsWith("```json")) {
        return JSON.parse(res.slice(7, -3)).reviews;
      } else {
        return JSON.parse(res).reviews;
      }
    } else if (AI_PROVIDER === 'anthropic' && anthropic) {
      const response = await anthropic.messages.create({
        model: ANTHROPIC_API_MODEL,
        max_tokens: 1024,
        temperature: 0.2,
        messages: [
          {
            "role": "user", 
            "content": "You are an AI code reviewer. You must respond in JSON format."
        },
        {
            "role": "assistant",
            "content": "Here is the JSON requested:\n{"
        }
        ],
      });

      // Handle Anthropic's response format
      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Anthropic API');
      }

      const res = content.text.trim();
      if (res.startsWith("```json")) {
        return JSON.parse(res.slice(7, -3)).reviews;
      } else {
        return JSON.parse(res).reviews;
      }
    } else {
      throw new Error(`Invalid AI provider: ${AI_PROVIDER}`);
    }
  } catch (error) {
    console.error("Error:", error);
    return null;
  }
}

function createComment(
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
    return {
      body: aiResponse.reviewComment,
      path: file.to,
      line: Number(aiResponse.lineNumber),
    };
  });
}

async function createReviewComment(
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

async function main() {
  const prDetails = await getPRDetails();
  let diff: string | null;
  const eventData = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
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

  const comments = await analyzeCode(filteredDiff, prDetails, prIgnore);
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
