# HyperCLI API Key Test Script

Test API keys from the 4001/keys console section locally with comprehensive diagnostics.

## Requirements

```bash
pip install requests openai
```

## Usage

### Test all endpoints
```bash
python test_api_keys.py "your-api-key-here"
```

### Test specific endpoint
```bash
python test_api_keys.py "your-api-key-here" --test balance
python test_api_keys.py "your-api-key-here" --test llm_models
```

### Use custom base URL
```bash
python test_api_keys.py "your-api-key-here" --base-url https://staging.hypercli.com
```

## Features

- 🔍 **Debug Information**: Shows connection details and authentication status
- 🎨 **Color-coded Output**: Easy-to-read success/failure indicators  
- 📊 **Formatted Results**: Clean display of API responses
- ⚡ **Fast Testing**: Quickly validate API key across all services

## What it tests

1. **API Key Management** - Verify key can access key management endpoints
2. **User Information** - Test user profile/info retrieval
3. **Account Balance** - Check balance and billing info access
4. **LLM Models** - List available AI models (OpenAI-compatible API)
5. **LLM Chat** - Send a test chat completion request
6. **Render List** - Access GPU rendering job history
7. **Render Creation** - Create and immediately cancel a test render (no charges)
8. **Bot/Chat API** - Access chat/conversation history

## Example Output

```
HyperCLI API Key Test Suite
Base URL: https://api.hypercli.com
API Key: sk-12345...abcd
============================================================

✓ API Key Management: Retrieved 3 API key(s)
    keys_count: 3

✓ User Information: Retrieved user information
    user_id: user-abc123
    email: user@example.com

✓ Account Balance: Retrieved balance information
    balance: $10.50
    currency: USD
    total_balance: $15.75

✓ LLM Models: Retrieved 25 models
    sample_models: ['deepseek-v3.1', 'claude-3-5-sonnet', 'gpt-4o', 'llama-3.3-70b', 'mistral-large']

✓ LLM Chat: Chat response received
    model: deepseek-v3.1
    response: API test successful

✓ Render List: Retrieved 3 renders
    total_renders: 3
    recent_renders: [{'id': 'render_123', 'status': 'completed', 'type': 'image', 'created': '2024-01-15', 'cost': '$2.50'}]

✓ Render Creation: Render created successfully (cancelled: 200)
    render_id: render_abc123
    state: pending

✗ Bot/Chat API: Bot API endpoint not accessible or not configured

============================================================
Test Summary
Passed: 7/8
Failed: 1/8

⚠ Some tests passed. API key has partial functionality.
```

## Troubleshooting

### Common Issues

**"Invalid token: Not enough segments"**
- Your API key format is incorrect
- HyperCLI API keys are JWT tokens (long strings with periods)
- Example format: `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoi...`

**"Authentication failed" but balance works**
- Different endpoints have different authentication requirements
- This is normal behavior - the script tests multiple authentication patterns

**"Request blocked/rate limited"**
- Your account may have usage limits
- Try again later or check your account tier

**Debug Information**
The script shows diagnostic info including:
- API key format (first 8 characters)
- Base URLs being tested
- Health check status
- Authentication headers

This helps identify connectivity and authentication issues quickly.

## Notes

- The render creation test creates a minimal test render and immediately cancels it to avoid charges
- Some endpoints might not be accessible depending on your account tier
- Bot/Chat API might be on a different subdomain or require special configuration
- All tests are non-destructive except for the cancelled test render