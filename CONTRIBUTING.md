# Contributing

Thanks for taking a look at QuotaPot.

1. Fork the repository and create a branch.
2. Keep the plugin dependency-free: it should keep working with plain Node 22
   and a stock DSH install.
3. Run the checks before opening a pull request:

   ```sh
   node --check index.js
   node --check widget.js
   npm test
   ```

4. Describe the DSH version you tested with (Web or Desktop) in the pull
   request.

Please do not commit API keys, tokens, or screenshots that contain them.
