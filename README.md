# AI Code Reviewer

AI Code Reviewer is a GitHub Action that leverages OpenAI's GPT-4 or Anthropic's Claude API to provide intelligent feedback and suggestions on
your pull requests. This powerful tool helps improve code quality and saves developers time by automating the code
review process.

## Features

- Reviews pull requests using OpenAI's GPT-4o or Anthropic's Claude API
- Provides intelligent comments and suggestions for improving your code
- Filters out files that match specified exclude patterns
- Easy to set up and integrate into your GitHub workflow
- Flexible choice between AI providers

## Setup

1. You'll need either an OpenAI API key or an Anthropic API key:
   - For OpenAI: Sign up at [OpenAI](https://beta.openai.com/signup)
   - For Anthropic: Sign up at [Anthropic](https://console.anthropic.com/)

2. Add your chosen API key as a GitHub Secret in your repository:
   - For OpenAI: Add as `OPENAI_API_KEY`
   - For Anthropic: Add as `ANTHROPIC_API_KEY`
   You can find more information about GitHub Secrets [here](https://docs.github.com/en/actions/reference/encrypted-secrets).

3. Create a `.github/workflows/main.yml` file in your repository and add the following content:

```yaml
name: AI Code Reviewer

on:
  pull_request:
    types:
      - opened
      - synchronize
      - review_requested
permissions: write-all
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repo
        uses: actions/checkout@v3

      - name: AI Code Reviewer
        uses: your-username/ai-code-reviewer@main
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Choose your AI provider (openai or anthropic)
          AI_PROVIDER: "openai" # or "anthropic"
          
          # If using OpenAI
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENAI_API_MODEL: "gpt-4" # Optional: defaults to "gpt-4"
          
          # If using Anthropic
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          ANTHROPIC_API_MODEL: "claude-2" # Optional: defaults to "claude-2"
          
          exclude: "**/*.json, **/*.md" # Optional: exclude patterns separated by commas
```

4. Replace `your-username` with your GitHub username or organization name where the AI Code Reviewer repository is
   located.

5. Customize the configuration:
   - Choose your preferred AI provider using `AI_PROVIDER`
   - Configure the appropriate API key and model for your chosen provider
   - Use the `exclude` input to ignore certain file patterns from being reviewed

6. Commit the changes to your repository, and AI Code Reviewer will start working on your future pull requests.

7. Execute `bun run package` to generate the package.

## How It Works

The AI Code Reviewer GitHub Action retrieves the pull request diff, filters out excluded files, and sends code chunks to
your chosen AI provider's API. It then generates review comments based on the AI's response and adds them to the pull request.

### AI Provider Comparison

- **OpenAI (GPT-4)**
  - Excellent at understanding complex code patterns
  - Highly consistent in review style
  - Default choice for most use cases

- **Anthropic (Claude)**
  - Strong at providing detailed technical explanations
  - Particularly good at understanding large code contexts
  - Alternative option with different strengths

Choose the provider that best fits your needs based on these characteristics.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests to improve the AI Code Reviewer GitHub
Action.

Let the maintainer generate the final package (`yarn build` & `yarn package`).

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more information.
