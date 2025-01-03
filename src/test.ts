import { writeFileSync } from "fs";
import parseDiff from "parse-diff";
import minimatch from "minimatch";
import {
  getConfig,
  getPRDetails,
  getDiff,
  analyzeCode
} from "./main";

async function main() {
  // Get PR URL from command line argument
  const prUrl = process.argv[2];
  if (!prUrl) {
    console.error('Please provide a GitHub PR URL as an argument');
    console.error('Example: npx ts-node src/test.ts https://github.com/owner/repo/pull/123');
    process.exit(1);
  }

  try {
    // Initialize configuration (this sets up the AI client)
    getConfig();

    // Get PR details
    const prDetails = await getPRDetails(prUrl);
    
    // Get diff
    const diff = await getDiff(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number
    );

    if (!diff) {
      console.log("No diff found");
      return;
    }

    const parsedDiff = parseDiff(diff);

    // Filter files based on exclude patterns (if any)
    const excludePatterns = (process.env.EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean);
    const filteredDiff = excludePatterns.length > 0
      ? parsedDiff.filter(file => !excludePatterns.some(pattern => minimatch(file.to ?? "", pattern)))
      : parsedDiff;

    // Get PR ignore patterns
    const prIgnore = (process.env.PR_IGNORE || '').split(',').map(line => `- ${line.trim()}`).join('\n');

    // Analyze code and get review comments
    const comments = await analyzeCode(filteredDiff, prDetails, prIgnore);

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
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`Review completed! Results written to ${outputPath}`);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);
