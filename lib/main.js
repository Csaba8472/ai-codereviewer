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
exports.anthropic = exports.openai = exports.octokit = void 0;
exports.getConfig = getConfig;
exports.getPRDetails = getPRDetails;
exports.getFileContent = getFileContent;
exports.getDiff = getDiff;
exports.analyzeCode = analyzeCode;
exports.createPrompt = createPrompt;
exports.getAIResponse = getAIResponse;
exports.createComment = createComment;
exports.createReviewComment = createReviewComment;
const fs_1 = require("fs");
const core = __importStar(require("@actions/core"));
const openai_1 = __importDefault(require("openai"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const rest_1 = require("@octokit/rest");
const parse_diff_1 = __importDefault(require("parse-diff"));
const minimatch_1 = __importDefault(require("minimatch"));
// Configuration can come from GitHub Actions or environment variables
function getConfig() {
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
exports.octokit = new rest_1.Octokit({ auth: config.GITHUB_TOKEN });
exports.openai = config.AI_PROVIDER === 'openai' ? new openai_1.default({
    apiKey: config.OPENAI_API_KEY,
}) : null;
exports.anthropic = config.AI_PROVIDER === 'anthropic' ? new sdk_1.default({
    apiKey: config.ANTHROPIC_API_KEY,
}) : null;
function getPRDetails(prUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        if (prUrl) {
            // Parse PR URL format: https://github.com/owner/repo/pull/number
            const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
            if (!match) {
                throw new Error('Invalid GitHub PR URL. Format should be: https://github.com/owner/repo/pull/number');
            }
            const [, owner, repo, pullNumber] = match;
            const prResponse = yield exports.octokit.pulls.get({
                owner,
                repo,
                pull_number: parseInt(pullNumber, 10),
            });
            return {
                owner,
                repo,
                pull_number: parseInt(pullNumber, 10),
                title: (_a = prResponse.data.title) !== null && _a !== void 0 ? _a : "",
                description: (_b = prResponse.data.body) !== null && _b !== void 0 ? _b : "",
            };
        }
        else {
            // GitHub Actions context
            const eventPath = process.env.GITHUB_EVENT_PATH;
            if (!eventPath) {
                throw new Error('GITHUB_EVENT_PATH environment variable is not set');
            }
            const { repository, number } = JSON.parse((0, fs_1.readFileSync)(eventPath, "utf8"));
            const prResponse = yield exports.octokit.pulls.get({
                owner: repository.owner.login,
                repo: repository.name,
                pull_number: number,
            });
            return {
                owner: repository.owner.login,
                repo: repository.name,
                pull_number: number,
                title: (_c = prResponse.data.title) !== null && _c !== void 0 ? _c : "",
                description: (_d = prResponse.data.body) !== null && _d !== void 0 ? _d : "",
            };
        }
    });
}
function getFileContent(owner, repo, path, ref) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield exports.octokit.repos.getContent({
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
        const response = yield exports.octokit.pulls.get({
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
    // Sanitize inputs to prevent control characters
    const sanitizeText = (text) => text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
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
function getAIResponse(prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (config.AI_PROVIDER === 'openai' && exports.openai) {
                const queryConfig = {
                    model: config.OPENAI_API_MODEL,
                    temperature: 0.2,
                    max_tokens: 700,
                    top_p: 1,
                    frequency_penalty: 0,
                    presence_penalty: 0
                };
                const response = yield exports.openai.chat.completions.create(Object.assign(Object.assign({}, queryConfig), { response_format: { type: "json_object" }, messages: [
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
            else if (config.AI_PROVIDER === 'anthropic' && exports.anthropic) {
                const response = yield exports.anthropic.messages.create({
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
            }
            else {
                throw new Error(`Invalid AI provider: ${config.AI_PROVIDER}`);
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
        // Sanitize file path and review comment
        const sanitizeText = (text) => text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
        const sanitizedPath = sanitizeText(file.to);
        const sanitizedComment = sanitizeText(aiResponse.reviewComment);
        return {
            body: sanitizedComment,
            path: sanitizedPath,
            line: Number(aiResponse.lineNumber),
        };
    });
}
function createReviewComment(owner, repo, pull_number, comments) {
    return __awaiter(this, void 0, void 0, function* () {
        yield exports.octokit.pulls.createReview({
            owner,
            repo,
            pull_number,
            comments,
            event: "COMMENT",
        });
    });
}
// Only run main when executed directly (not imported)
if (require.main === module) {
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
                const response = yield exports.octokit.repos.compareCommits({
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
            const comments = yield analyzeCode(filteredDiff, prDetails, config.prIgnore);
            if (comments.length > 0) {
                yield createReviewComment(prDetails.owner, prDetails.repo, prDetails.pull_number, comments);
            }
        });
    }
    main().catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });
}
