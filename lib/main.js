"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const core = __importStar(require("@actions/core"));
const openai_1 = __importDefault(require("openai"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const rest_1 = require("@octokit/rest");
const parse_diff_1 = __importDefault(require("parse-diff"));
const minimatch_1 = __importDefault(require("minimatch"));
const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN");
const AI_PROVIDER = core.getInput("AI_PROVIDER");
const OPENAI_API_KEY = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL = core.getInput("OPENAI_API_MODEL");
const ANTHROPIC_API_KEY = core.getInput("ANTHROPIC_API_KEY");
const ANTHROPIC_API_MODEL = core.getInput("ANTHROPIC_API_MODEL");
const role = core.getInput("role");
const tech_stack = core.getInput("tech_stack");
const prIgnore = core.getMultilineInput("pr_ignore").map(customPrompt => `- ${customPrompt}`).join("\n");
// Validate API keys based on provider
if (AI_PROVIDER === 'openai' && !OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when using OpenAI provider');
}
if (AI_PROVIDER === 'anthropic' && !ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required when using Anthropic provider');
}
const octokit = new rest_1.Octokit({ auth: GITHUB_TOKEN });
const openai = AI_PROVIDER === 'openai' ? new openai_1.default({
    apiKey: OPENAI_API_KEY,
}) : null;
const anthropic = AI_PROVIDER === 'anthropic' ? new sdk_1.default({
    apiKey: ANTHROPIC_API_KEY,
}) : null;
function getPRDetails() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const eventPath = process.env.GITHUB_EVENT_PATH;
        if (!eventPath) {
            throw new Error('GITHUB_EVENT_PATH environment variable is not set');
        }
        const { repository, number } = JSON.parse((0, fs_1.readFileSync)(eventPath, "utf8"));
        const prResponse = yield octokit.pulls.get({
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
        });
        return {
            owner: repository.owner.login,
            repo: repository.name,
            pull_number: number,
            title: (_a = prResponse.data.title) !== null && _a !== void 0 ? _a : "",
            description: (_b = prResponse.data.body) !== null && _b !== void 0 ? _b : "",
        };
    });
}
function getFileContent(owner, repo, path, ref) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield octokit.repos.getContent({
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
        }
        catch (error) {
            console.error(`Error getting file content: ${error}`);
            return null;
        }
    });
}
function getDiff(owner, repo, pull_number) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield octokit.pulls.get({
            owner,
            repo,
            pull_number,
            mediaType: { format: "diff" },
        });
        // @ts-expect-error - response.data is a string
        return response.data;
    });
}
function analyzeCode(parsedDiff, prDetails, prIgnore) {
    return __awaiter(this, void 0, void 0, function* () {
        const comments = [];
        for (const file of parsedDiff) {
            if (file.to === "/dev/null")
                continue; // Ignore deleted files
            // Get the full file content
            const fileContent = yield getFileContent(prDetails.owner, prDetails.repo, file.to, `pull/${prDetails.pull_number}/head`);
            for (const chunk of file.chunks) {
                const prompt = createPrompt(file, chunk, prDetails, prIgnore, fileContent);
                const aiResponse = yield getAIResponse(prompt);
                if (aiResponse) {
                    const newComments = createComment(file, chunk, aiResponse);
                    if (newComments) {
                        comments.push(...newComments);
                    }
                }
            }
        }
        return comments;
    });
}
function createPrompt(file, chunk, prDetails, prIgnore, fullFileContent) {
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

Review the following code diff in the file "${file.to}" and take the pull request title and description into account when writing the response.
  
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
function getAIResponse(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
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
                const response = yield openai.chat.completions.create(Object.assign(Object.assign({}, queryConfig), { response_format: { type: "json_object" }, messages: [
                        {
                            role: "system",
                            content: prompt,
                        },
                    ] }));
                const res = ((_b = (_a = response.choices[0].message) === null || _a === void 0 ? void 0 : _a.content) === null || _b === void 0 ? void 0 : _b.trim()) || "{}";
                let jsonStr = res;
                if (res.startsWith("```json")) {
                    // Remove the markdown code block markers and any trailing whitespace
                    jsonStr = res.replace(/^```json\s*/, '').replace(/\s*```\s*$/, '');
                }
                return JSON.parse(jsonStr).reviews;
            }
            else if (AI_PROVIDER === 'anthropic' && anthropic) {
                const response = yield anthropic.messages.create({
                    model: ANTHROPIC_API_MODEL,
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
            }
            else {
                throw new Error(`Invalid AI provider: ${AI_PROVIDER}`);
            }
        }
        catch (error) {
            console.error("Error:", error);
            return null;
        }
    });
}
function createComment(file, chunk, aiResponses) {
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
function createReviewComment(owner, repo, pull_number, comments) {
    return __awaiter(this, void 0, void 0, function* () {
        yield octokit.pulls.createReview({
            owner,
            repo,
            pull_number,
            comments,
            event: "COMMENT",
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const prDetails = yield getPRDetails();
        let diff;
        const eventPath = process.env.GITHUB_EVENT_PATH;
        if (!eventPath) {
            throw new Error('GITHUB_EVENT_PATH environment variable is not set');
        }
        const eventData = JSON.parse((0, fs_1.readFileSync)(eventPath, "utf8"));
        if (eventData.action === "opened") {
            diff = yield getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
        }
        else if (eventData.action === "review_requested") {
            diff = yield getDiff(prDetails.owner, prDetails.repo, prDetails.pull_number);
        }
        else if (eventData.action === "synchronize") {
            const newBaseSha = eventData.before;
            const newHeadSha = eventData.after;
            const response = yield octokit.repos.compareCommits({
                headers: {
                    accept: "application/vnd.github.v3.diff",
                },
                owner: prDetails.owner,
                repo: prDetails.repo,
                base: newBaseSha,
                head: newHeadSha,
            });
            diff = String(response.data);
        }
        else {
            console.log("Unsupported event:", process.env.GITHUB_EVENT_NAME);
            return;
        }
        if (!diff) {
            console.log("No diff found");
            return;
        }
        const parsedDiff = (0, parse_diff_1.default)(diff);
        const excludePatterns = core
            .getInput("exclude")
            .split(",")
            .map((s) => s.trim());
        const filteredDiff = parsedDiff.filter((file) => {
            return !excludePatterns.some((pattern) => { var _a; return (0, minimatch_1.default)((_a = file.to) !== null && _a !== void 0 ? _a : "", pattern); });
        });
        const comments = yield analyzeCode(filteredDiff, prDetails, prIgnore);
        if (comments.length > 0) {
            yield createReviewComment(prDetails.owner, prDetails.repo, prDetails.pull_number, comments);
        }
    });
}
main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
