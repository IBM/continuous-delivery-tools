# Test

All automated tests live in this directory.
Before running tests, ensure that you have completed the setup steps in the main [README.md](../README.md), including installing all prerequisites and dependencies.

## Getting Started
1. **Clone the repository**
   ```bash
   git clone https://github.com/IBM/continuous-delivery-tools.git
   cd continuous-delivery-tools
   ```
2. **Install dependencies**
    ```bash
    npm install
    ```
3. **Test configuration**

    Before running tests, create a local configuration file:
    ```bash
    cp test/config/local.template.json test/config/local.json
    ```
    Then open `test/config/local.json` and replace all placeholder values with your local or test environment settings.
4. **Running the tests**
    
    To execute the test suite:
    ```bash
    npm run test
    ```
