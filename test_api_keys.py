#!/usr/bin/env python3
"""
HyperCLI API Key Test Script

Test API keys from the 4001/keys console section locally.
This script tests various HyperCLI API endpoints to verify key functionality.

IMPORTANT: API Keys vs Auth Tokens
- API Keys (c3_api_*): Used for programmatic API access (LLM, renders, jobs)
- Auth Tokens (JWT from Turnkey/wallet login): Used for console web UI (/user, /balance)

Some endpoints (like /user and /balance) require auth_token from console login,
not the API key. These are primarily for the web console UI.

API keys work with:
- /keys (API key management)
- /api/renders (render management)  
- /v1/* (LLM API endpoints)

Usage:
    python test_api_keys.py <API_KEY>
    python test_api_keys.py <API_KEY> --base-url https://api.hypercli.com
    python test_api_keys.py <API_KEY> --test render_list

Requirements:
    pip install requests openai
"""

import argparse
import json
import sys
import time
from typing import Dict, Any, Optional
import requests
from openai import OpenAI


class Colors:
    """ANSI color codes for terminal output"""
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    END = '\033[0m'


class HyperCLITester:
    def __init__(self, api_key: str, base_url: str = "https://api.hypercli.com"):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        
        # Set up different API base URLs based on HyperCLI architecture
        # Based on documentation: api.hypercli.com is the production API
        self.auth_base = self.base_url  # Auth endpoints are directly on base
        self.llm_base = f"{self.base_url}/v1"    # LLM endpoints  
        self.render_base = self.base_url  # Render endpoints
        self.bot_base = self.base_url  # Bot endpoints (may not work from same domain)
        
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'User-Agent': 'HyperCLI-Test-Script/1.0'
        })
        
        # OpenAI client for LLM API
        self.openai_client = OpenAI(
            api_key=api_key,
            base_url=self.llm_base
        )
        
        self.results = []

    def debug_auth_info(self):
        """Debug authentication and session info"""
        print(f"{Colors.BLUE}═══ Debug Information ══════════════════════════{Colors.END}")
        print(f"API Key: {self.api_key[:8]}..." if len(self.api_key) > 8 else f"API Key: {self.api_key}")
        print(f"Auth Base URL: {self.auth_base}")
        print(f"Render Base URL: {self.render_base}")
        print(f"LLM Base URL: {self.llm_base}")
        
        # Test basic auth header
        print(f"Authorization Header: Bearer {self.api_key[:8]}..." if len(self.api_key) > 8 else f"Authorization Header: Bearer {self.api_key}")
        
        # Check if we can make a basic connection
        try:
            response = self.session.get(f"{self.auth_base}/health", timeout=5)
            print(f"Health Check Response: {response.status_code}")
        except:
            print("Health Check: Failed to connect")
        
        print(f"{Colors.BLUE}════════════════════════════════════════════════{Colors.END}")
        print()

    def log_result(self, test_name: str, success: bool, message: str, data: Any = None):
        """Log test result"""
        status = f"{Colors.GREEN}✓{Colors.END}" if success else f"{Colors.RED}✗{Colors.END}"
        print(f"{status} {test_name}: {message}")
        
        self.results.append({
            'test': test_name,
            'success': success,
            'message': message,
            'data': data
        })
        
        if data and isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, list):
                    if len(value) > 0 and isinstance(value[0], dict):
                        # Pretty print first few items of complex lists
                        print(f"    {Colors.CYAN}{key}:{Colors.END} {len(value)} items")
                        for i, item in enumerate(value[:3]):  # Show first 3 items
                            if isinstance(item, dict):
                                # Show key fields from dict items
                                item_summary = []
                                for k, v in item.items():
                                    if k in ['id', 'name', 'state', 'status', 'created_at', 'model', 'type']:
                                        item_summary.append(f"{k}: {str(v)[:50]}")
                                if item_summary:
                                    print(f"      [{i+1}] {', '.join(item_summary[:3])}")
                        if len(value) > 3:
                            print(f"      ... and {len(value) - 3} more")
                    else:
                        print(f"    {Colors.CYAN}{key}:{Colors.END} {value[:5] if len(value) > 5 else value}")
                elif isinstance(value, dict):
                    print(f"    {Colors.CYAN}{key}:{Colors.END} dict with {len(value)} keys")
                else:
                    value_str = str(value)
                    if len(value_str) > 100:
                        value_str = value_str[:100] + "..."
                    print(f"    {Colors.CYAN}{key}:{Colors.END} {value_str}")
        print()

    def test_api_key_info(self) -> bool:
        """Test API key information endpoint"""
        try:
            # Console uses getAuthBackendUrl("/keys") which is just /keys, not /api/keys
            response = self.session.get(f"{self.auth_base}/keys")
            
            if response.status_code == 200:
                keys = response.json()
                self.log_result(
                    "API Key Info", 
                    True, 
                    f"Retrieved {len(keys)} API key(s)",
                    {
                        "keys_count": len(keys),
                        "keys": [{"name": k.get("name"), "key_id": k.get("key_id"), "is_active": k.get("is_active")} for k in keys[:3]] if keys else []
                    }
                )
                return True
            elif response.status_code == 404:
                # 404 means no keys exist yet (as per console logic)
                self.log_result("API Key Info", True, "No API keys found (empty list)")
                return True
            elif response.status_code == 401:
                self.log_result(
                    "API Key Info", 
                    False, 
                    "Authentication failed - check your API key"
                )
                return False
            else:
                self.log_result(
                    "API Key Info", 
                    False, 
                    f"HTTP {response.status_code}: {response.text[:100]}..."
                )
                return False
                
        except Exception as e:
            self.log_result("API Key Info", False, f"Error: {str(e)}")
            return False

    def test_user_info(self) -> bool:
        """Test user information endpoint"""
        try:
            # Try both endpoints - API keys may work with /api/ prefix
            endpoints = [
                f"{self.auth_base}/api/user",  # API key endpoint
                f"{self.auth_base}/user"       # Console/auth_token endpoint
            ]
            
            for endpoint in endpoints:
                response = self.session.get(endpoint)
                
                if response.status_code == 200:
                    user_info = response.json()
                    self.log_result(
                        "User Info", 
                        True, 
                        f"Retrieved user information",
                        {
                            "user_id": user_info.get("id", "N/A"),
                            "email": user_info.get("email", "N/A"),
                            "name": user_info.get("name", "N/A"),
                            "endpoint_used": endpoint
                        }
                    )
                    return True
                elif response.status_code == 404:
                    continue  # Try next endpoint
                elif response.status_code == 401:
                    continue  # Try next endpoint
            
            # If both failed
            self.log_result(
                "User Info", 
                False, 
                "Both /api/user and /user endpoints failed - may require web session auth_token"
            )
            return False
                
        except Exception as e:
            self.log_result("User Info", False, f"Error: {str(e)}")
            return False

    def test_balance(self) -> bool:
        """Test balance endpoint"""
        try:
            # Try both endpoints - API keys work with /api/ prefix
            endpoints = [
                f"{self.auth_base}/api/balance",  # API key endpoint
                f"{self.auth_base}/balance"       # Console/auth_token endpoint
            ]
            
            for endpoint in endpoints:
                response = self.session.get(endpoint)
                
                if response.status_code == 200:
                    balance = response.json()
                    self.log_result(
                        "Balance", 
                        True, 
                        f"Retrieved balance information",
                        {
                            "balance": balance.get("balance", "N/A"),
                            "currency": balance.get("currency", "N/A"),
                            "total_balance": balance.get("total_balance", "N/A"),
                            "endpoint_used": endpoint
                        }
                    )
                    return True
                elif response.status_code == 404:
                    continue  # Try next endpoint
                elif response.status_code == 401:
                    continue  # Try next endpoint
            
            # If both failed
            self.log_result(
                "Balance", 
                False, 
                "Both /api/balance and /balance endpoints failed - may require web session auth_token"
            )
            return False
                
        except Exception as e:
            self.log_result("Balance", False, f"Error: {str(e)}")
            return False

    def test_llm_models(self) -> bool:
        """Test LLM models endpoint (OpenAI compatible)"""
        try:
            models = list(self.openai_client.models.list())
            
            if models:
                model_names = [model.id for model in models[:5]]  # Show first 5
                self.log_result(
                    "LLM Models", 
                    True, 
                    f"Retrieved {len(models)} models",
                    {"total_models": len(models), "sample_models": model_names}
                )
                return True
            else:
                self.log_result("LLM Models", False, "No models returned")
                return False
                
        except Exception as e:
            error_msg = str(e)
            if "rate limit" in error_msg.lower() or "blocked" in error_msg.lower():
                self.log_result("LLM Models", False, f"Request blocked/rate limited: {error_msg}")
            elif "401" in error_msg or "unauthorized" in error_msg.lower():
                self.log_result("LLM Models", False, f"Authentication failed for LLM API: {error_msg}")
            else:
                self.log_result("LLM Models", False, f"Error: {error_msg}")
            return False

    def test_llm_chat(self, model: str = None) -> bool:
        """Test LLM chat endpoint with a simple prompt"""
        try:
            # Get available models first if no model specified
            if not model:
                try:
                    models = list(self.openai_client.models.list())
                    if not models:
                        self.log_result("LLM Chat", False, "No models available")
                        return False
                    model = models[0].id
                except:
                    # If we can't get models, try a common one
                    model = "gpt-3.5-turbo"  # Fallback model
            
            response = self.openai_client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "user", "content": "Say 'API test successful' and nothing else."}
                ],
                max_tokens=10,
                temperature=0
            )
            
            if response.choices and response.choices[0].message:
                content = response.choices[0].message.content.strip()
                self.log_result(
                    "LLM Chat", 
                    True, 
                    f"Chat response received",
                    {
                        "model_used": model,
                        "response_text": content[:100] + "..." if len(content) > 100 else content,
                        "usage": getattr(response, 'usage', {})
                    }
                )
                return True
            else:
                self.log_result("LLM Chat", False, "No response content")
                return False
                
        except Exception as e:
            error_msg = str(e)
            if "rate limit" in error_msg.lower() or "blocked" in error_msg.lower():
                self.log_result("LLM Chat", False, f"Request blocked/rate limited: {error_msg}")
            elif "401" in error_msg or "unauthorized" in error_msg.lower():
                self.log_result("LLM Chat", False, f"Authentication failed for LLM API: {error_msg}")
            elif "model" in error_msg.lower() and "does not exist" in error_msg.lower():
                self.log_result("LLM Chat", False, f"Model not available: {error_msg}")
            else:
                self.log_result("LLM Chat", False, f"Error: {error_msg}")
            return False

    def test_render_list(self) -> bool:
        """Test render list endpoint"""
        try:
            response = self.session.get(f"{self.render_base}/api/renders?limit=5")
            
            if response.status_code == 200:
                data = response.json()
                renders = data.get("items", data) if isinstance(data, dict) else data
                
                # Format render data nicely
                render_info = {
                    "total_renders": len(renders) if isinstance(renders, list) else 0,
                    "recent_renders": []
                }
                
                # Show first 3 renders with key info
                if isinstance(renders, list):
                    for render in renders[:3]:
                        render_summary = {
                            "id": render.get("id", "N/A"),
                            "status": render.get("status", "N/A"),
                            "type": render.get("type", render.get("workflow", "N/A")),
                            "created": render.get("created_at", render.get("created", "N/A")),
                            "cost": render.get("cost", render.get("price", "N/A"))
                        }
                        render_info["recent_renders"].append(render_summary)
                
                self.log_result(
                    "Render List", 
                    True, 
                    f"Retrieved {render_info['total_renders']} renders",
                    render_info
                )
                return True
            else:
                self.log_result(
                    "Render List", 
                    False, 
                    f"HTTP {response.status_code}: {response.text[:100]}..."
                )
                return False
                
        except Exception as e:
            self.log_result("Render List", False, f"Error: {str(e)}")
            return False

    def test_render_create(self) -> bool:
        """Test render creation (dry run - cancel immediately)"""
        try:
            # Create a simple test render
            payload = {
                "type": "comfyui",
                "params": {
                    "workflow": "flux_schnell",
                    "prompt": "API test - simple red circle",
                    "width": 512,
                    "height": 512,
                    "steps": 1
                }
            }
            
            response = self.session.post(f"{self.render_base}/api/renders", json=payload)
            
            if response.status_code in [200, 201]:
                render_data = response.json()
                render_id = render_data.get("id")
                
                # Immediately cancel the render to avoid charges
                if render_id:
                    cancel_response = self.session.delete(f"{self.render_base}/api/renders/{render_id}")
                    cancel_msg = f" (cancelled: {cancel_response.status_code})" if cancel_response.status_code in [200, 204] else " (cancel failed)"
                else:
                    cancel_msg = ""
                
                self.log_result(
                    "Render Creation", 
                    True, 
                    f"Render created successfully{cancel_msg}",
                    {
                        "render_id": render_id,
                        "state": render_data.get("state", "N/A")
                    }
                )
                return True
            else:
                self.log_result(
                    "Render Creation", 
                    False, 
                    f"HTTP {response.status_code}: {response.text[:200]}..."
                )
                return False
                
        except Exception as e:
            self.log_result("Render Creation", False, f"Error: {str(e)}")
            return False

    def test_bot_chats(self) -> bool:
        """Test bot/chat API endpoint"""
        try:
            # Try to get bot API URL from typical patterns
            # Note: Bot API is typically on a different subdomain/URL (BOT_API_URL env var)
            # This test may fail if the bot API is not accessible from the same domain
            bot_urls = [
                f"{self.bot_base}/chats",  # Direct path (may work)
                f"{self.bot_base}/api/chats",  # Alternative path
            ]
            
            for bot_url in bot_urls:
                try:
                    response = self.session.get(bot_url)
                    if response.status_code == 200:
                        chats = response.json()
                        chat_list = chats if isinstance(chats, list) else chats.get("chats", [])
                        
                        self.log_result(
                            "Bot Chats", 
                            True, 
                            f"Retrieved chat threads",
                            {"chats_count": len(chat_list)}
                        )
                        return True
                    elif response.status_code == 404:
                        continue  # Try next URL
                    else:
                        self.log_result(
                            "Bot Chats", 
                            False, 
                            f"HTTP {response.status_code}: {response.text[:100]}..."
                        )
                        return False
                except:
                    continue
            
            self.log_result(
                "Bot Chats", 
                False, 
                "Bot API not accessible from this domain (typically uses separate subdomain)"
            )
            return False
                
        except Exception as e:
            self.log_result("Bot Chats", False, f"Error: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all API tests"""
        print(f"{Colors.BOLD}{Colors.BLUE}HyperCLI API Key Test Suite{Colors.END}")
        print(f"{Colors.CYAN}Base URL:{Colors.END} {self.base_url}")
        print(f"{Colors.CYAN}Auth API:{Colors.END} {self.auth_base}")
        print(f"{Colors.CYAN}LLM API:{Colors.END} {self.llm_base}")
        print(f"{Colors.CYAN}API Key:{Colors.END} {self.api_key[:8]}...{self.api_key[-4:]}")
        print("=" * 60)
        print()
        
        # Show debug info
        self.debug_auth_info()

        tests = [
            ("API Key Management", self.test_api_key_info),
            ("User Information", self.test_user_info),
            ("Account Balance", self.test_balance),
            ("LLM Models", self.test_llm_models),
            ("LLM Chat", self.test_llm_chat),
            ("Render List", self.test_render_list),
            ("Render Creation", self.test_render_create),
            ("Bot/Chat API", self.test_bot_chats),
        ]

        for test_name, test_func in tests:
            try:
                test_func()
            except KeyboardInterrupt:
                print(f"\n{Colors.YELLOW}Test interrupted by user{Colors.END}")
                break
            except Exception as e:
                self.log_result(test_name, False, f"Unexpected error: {str(e)}")

        self.print_summary()

    def print_summary(self):
        """Print test summary"""
        print("=" * 60)
        print(f"{Colors.BOLD}Test Summary{Colors.END}")
        
        passed = sum(1 for r in self.results if r['success'])
        total = len(self.results)
        
        print(f"{Colors.GREEN}Passed:{Colors.END} {passed}/{total}")
        print(f"{Colors.RED}Failed:{Colors.END} {total - passed}/{total}")
        
        if passed == total:
            print(f"\n{Colors.GREEN}{Colors.BOLD}✓ All tests passed! API key is fully functional.{Colors.END}")
        elif passed > 0:
            print(f"\n{Colors.YELLOW}{Colors.BOLD}⚠ Some tests passed. API key has partial functionality.{Colors.END}")
        else:
            print(f"\n{Colors.RED}{Colors.BOLD}✗ All tests failed. Check API key validity.{Colors.END}")


def main():
    parser = argparse.ArgumentParser(
        description="Test HyperCLI API keys functionality",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_api_keys.py sk-1234567890abcdef
  python test_api_keys.py sk-1234567890abcdef --base-url https://api.hypercli.com
  python test_api_keys.py sk-1234567890abcdef --test llm_models
        """
    )
    
    parser.add_argument("api_key", help="HyperCLI API key to test")
    parser.add_argument(
        "--base-url", 
        default="https://api.hypercli.com",
        help="Base URL for HyperCLI API (default: https://api.hypercli.com)"
    )
    parser.add_argument(
        "--test",
        choices=["api_key_info", "user_info", "balance", "llm_models", "llm_chat", "render_list", "render_create", "bot_chats"],
        help="Run only a specific test"
    )
    
    args = parser.parse_args()
    
    if not args.api_key:
        print(f"{Colors.RED}Error: API key is required{Colors.END}")
        sys.exit(1)
    
    tester = HyperCLITester(args.api_key, args.base_url)
    
    if args.test:
        # Run specific test
        test_func = getattr(tester, f"test_{args.test}")
        test_func()
        tester.print_summary()
    else:
        # Run all tests
        tester.run_all_tests()


if __name__ == "__main__":
    main()