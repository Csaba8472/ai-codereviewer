"use strict";
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
const parse_diff_1 = __importDefault(require("parse-diff"));
const minimatch_1 = __importDefault(require("minimatch"));
const main_1 = require("./main");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // Get PR URL from command line argument
        const prUrl = process.argv[2];
        if (!prUrl) {
            console.error('Please provide a GitHub PR URL as an argument');
            console.error('Example: npx ts-node src/test.ts https://github.com/owner/repo/pull/123');
            process.exit(1);
        }
        try {
            // Initialize configuration (this sets up the AI client)
            (0, main_1.getConfig)();
            // Get PR details
            const prDetails = yield (0, main_1.getPRDetails)(prUrl);
            // Get diff
            const diff = yield (0, main_1.getDiff)(prDetails.owner, prDetails.repo, prDetails.pull_number);
            if (!diff) {
                console.log("No diff found");
                return;
            }
            const parsedDiff = (0, parse_diff_1.default)(diff);
            // Filter files based on exclude patterns (if any)
            const excludePatterns = (process.env.EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean);
            const filteredDiff = excludePatterns.length > 0
                ? parsedDiff.filter(file => !excludePatterns.some(pattern => { var _a; return (0, minimatch_1.default)((_a = file.to) !== null && _a !== void 0 ? _a : "", pattern); }))
                : parsedDiff;
            // Get PR ignore patterns
            const prIgnore = (process.env.PR_IGNORE || '').split(',').map(line => `- ${line.trim()}`).join('\n');
            // Analyze code and get review comments
            const comments = yield (0, main_1.analyzeCode)(filteredDiff, prDetails, prIgnore);
            // Write results to a file
            const output = {
                pr: {
                    url: prUrl,
                    title: prDetails.title,
                    description: prDetails.description
                },
                reviews: comments
            };
            const outputPath = 'pr-review-output.json';
            (0, fs_1.writeFileSync)(outputPath, JSON.stringify(output, null, 2));
            console.log(`Review completed! Results written to ${outputPath}`);
        }
        catch (error) {
            console.error("Error:", error);
            process.exit(1);
        }
    });
}
// Run the script
main().catch(console.error);
