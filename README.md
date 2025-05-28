# Marshal Diff Validator Action

This GitHub Action runs Marshal AI's semantic diff validation on your pull requests. 

In order to use this workflow you will need to generate an api key using: {{}}.

From there add your api key to your 'Github Secrets' and reference them with your workflow as seen below!

## Usage

```yaml
steps:
  - uses: actions/checkout@v3
  - name: Marshal Validate Diff
    uses: marshal-ai/validate-validate-action@v1
    with:
      api-url: ${{ secrets.MARSHAL_API_URL }}
      api-key: ${{ secrets.MARSHAL_API_KEY }}
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}