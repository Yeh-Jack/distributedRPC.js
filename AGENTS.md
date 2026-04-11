# Agents

This project uses a set of specialized agents to handle different types of tasks and workflows.

## Available Agents

### code-reviewer
- **Purpose**: Reviews code changes for quality, best practices, and potential issues
- **Usage**: Automatically triggered when code is completed or manually invoked for review
- **Capabilities**:
  - Checks for coding standards compliance
  - Identifies potential bugs or security issues
  - Suggests improvements for readability and performance

### greeting-responder
- **Purpose**: Responds to user greetings with a friendly message or joke
- **Usage**: Automatically triggered when users say hello or similar greetings
- **Capabilities**:
  - Provides warm, welcoming responses
  - Shares programming-related jokes or facts
  - Maintains conversational flow

### general
- **Purpose**: General-purpose agent for researching complex questions and executing multi-step tasks
- **Usage**: For broad research, exploration, and complex problem solving
- **Capabilities**:
  - Codebase exploration and analysis
  - Multi-step task execution
  - Research and information gathering

### explore
- **Purpose**: Fast agent specialized for exploring codebases
- **Usage**: When you need to quickly find files by patterns or search code for keywords
- **Capabilities**:
  - File pattern matching with glob patterns
  - Code content searching with regex
  - Quick answers about codebase structure and functionality

## Agent Usage Examples

### Using a specific agent:
```
/task general "Explain how the UDP server handles network errors"
/task explore "Find all files that use the dgram module"
```

### Manual agent invocation:
```
/code-reviewer
/greeting-responder
```

## Task Management

All agents work with the task management system to track progress and ensure thoroughness. Tasks are automatically created when complex operations are performed, and can be viewed using:

- `/todo` - View current tasks
- `/status` - Check overall project status

## Build/Lint/Test Commands

### Building
```bash
pnpm run build          # Compile TypeScript to JavaScript
pnpm run dev            # Run development server with Vite
pnpm run docs           # Generate documentation with TypeDoc
```

### Testing
```bash
pnpm test               # Run all tests with Vitest
pnpm test:watch         # Run tests in watch mode
pnpm test:coverage      # Run tests with coverage report
```

To run a single test:
```bash
# Run specific test file
pnpm test src/__tests__/network/tcp-server.test.ts

# Run specific test suite within a file
pnpm test -- -t "TCP server should handle connections"
```

### Linting and Formatting
```bash
# TypeScript linting (uses ESLint)
npx eslint src/**/*.ts

# Code formatting with Prettier
npx prettier --write src/**/*.{ts,js,json}
```

## Code Style Guidelines

### Imports
- Use explicit relative imports for local modules: `import { MyClass } from '../common/logger'`
- Group imports in order: external libraries, internal modules, local modules
- Sort import statements alphabetically within each group

### Formatting
- Follow Prettier formatting rules (configured via .prettierrc)
- Use 2-space indentation for TypeScript files
- Prefer single quotes for strings unless template literals are needed
- No trailing commas in function parameters or arguments
- Always use semicolons

### Types
- Use TypeScript interfaces and types extensively
- Define clear return types for all functions
- Use strict null checks with `strict` compiler option enabled
- Prefer readonly properties when possible
- Use union types to represent multiple valid values

### Naming Conventions
- PascalCase for class names and interface names
- camelCase for variables, functions, and methods
- UPPER_SNAKE_CASE for constants
- Prefix private members with underscore (`_privateMethod`)
- Use descriptive names that clearly indicate purpose

### Error Handling
- Use try/catch blocks around asynchronous operations
- Implement proper error logging with Winston logger
- Create custom error types when needed
- Always handle errors in async functions appropriately
- Don't ignore caught exceptions unless explicitly documented

### Documentation
- Stick to JSON Schema Draft 7 and supports OpenAPI 3.1.
- Add comments to all public and protected APIs and complex methods
- Document parameters, return values, and potential exceptions
- Use OpenAPI 3.1 compatible formatting for automatic documentation generation

## Testing Guidelines

### Test Structure
- Place tests in `src/__tests__` directory following the same structure as source files
- Each test file should be named with `.test.ts` suffix (e.g., `tcp-server.test.ts`)
- Use descriptive test names that explain what is being tested
- Follow "Arrange, Act, Assert" pattern for test cases

### Test Coverage
- Aim for high code coverage: branches >75%, statements >80%, functions >90%
- Focus on testing edge cases and error conditions
- Mock external dependencies appropriately
- Ensure tests are isolated from each other

## Cursor/Copilot Rules
No specific Cursor or Copilot rules are defined in this repository.
