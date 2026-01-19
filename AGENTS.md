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