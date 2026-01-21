"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { useWallet } from "../contexts/WalletContext"
import { x402Api, updateX402Client } from "../services/x402Api"
import { debugLog } from "../utils/debug"
import { getAuthBackendUrl } from "../utils/api"
import { toUsdcUnits } from "../utils/currency"

interface TopUpModalProps {
  isOpen: boolean
  onClose: () => void
  userEmail?: string
  onSuccess: () => void
}

type PaymentMethod = "crypto" | "card"

export function TopUpModal({ isOpen, onClose, userEmail, onSuccess }: TopUpModalProps) {
  const { walletClient, address, isConnected, isConnecting, connectWallet, error: walletError } = useWallet()
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card")
  const [amount, setAmount] = useState<number>(10)
  const [email, setEmail] = useState<string>(userEmail || "")
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showCustomAmount, setShowCustomAmount] = useState(false)
  const [customAmountInput, setCustomAmountInput] = useState<string>("")

  // Update email when userEmail prop changes
  useEffect(() => {
    if (userEmail) {
      setEmail(userEmail)
    }
  }, [userEmail])

  // Update x402 client when wallet changes
  useEffect(() => {
    updateX402Client(walletClient)
  }, [walletClient])

  const minAmount = paymentMethod === "crypto" ? 0.1 : 5
  const sliderMaxAmount = 100
  const maxAmount = 1000

  const handleClose = () => {
    if (!isProcessing) {
      setAmount(10)
      setError(null)
      setSuccess(false)
      setShowCustomAmount(false)
      setCustomAmountInput("")
      onClose()
    }
  }

  const handlePaymentMethodChange = (method: PaymentMethod) => {
    setPaymentMethod(method)
    // Adjust amount if it's below the new minimum
    if (method === "card" && amount < 5) {
      setAmount(5)
    } else if (method === "crypto" && amount < 0.1) {
      setAmount(0.1)
    }
  }

  const handleCryptoPayment = async () => {
    setIsProcessing(true)
    setError(null)

    try {
      // Step 1: Connect wallet if not connected
      if (!isConnected) {
        debugLog("🔄 Step 1: Connecting MetaMask wallet...")
        await connectWallet()
        debugLog("✅ Wallet connected. Please click Pay again to continue.")
        setIsProcessing(false)
        return
      }

      // Step 2: Get auth token
      const authToken = document.cookie
        .split("; ")
        .find(row => row.startsWith("auth_token="))
        ?.split("=")[1]

      if (!authToken) {
        throw new Error("Authentication required. Please log in.")
      }

      // Step 3: Decode JWT to get user_id
      const tokenParts = authToken.split('.')
      if (tokenParts.length !== 3) {
        throw new Error("Invalid token format")
      }

      const payload = JSON.parse(atob(tokenParts[1]))
      const userId = payload.user_id || payload.sub

      if (!userId) {
        throw new Error("User ID not found in token")
      }

      debugLog("🔑 User ID from token:", userId)

      // Step 4: Make x402 payment
      // Convert to USDC units (6 decimals) - $0.10 = 100,000 units
      const usdcUnits = toUsdcUnits(amount)
      debugLog("💳 Initiating x402 payment for $" + amount + " (" + usdcUnits + " USDC units)")
      const result = await x402Api.topUp(usdcUnits, authToken, userId)
      debugLog("✅ Top up successful:", result)

      // Show success
      setSuccess(true)
      setTimeout(() => {
        onSuccess()
        handleClose()
      }, 2000)

    } catch (err: any) {
      debugLog("❌ Payment error:", err)

      // Handle validation errors from FastAPI
      let errorMessage = "Payment failed. Please try again."

      // Check if this is a wallet selection error from Phantom
      if (err.message?.includes("selectExtension") || err.message?.includes("EthProviderProxy")) {
        errorMessage = "Wallet error: Please disable Phantom wallet extension or use MetaMask only."
      } else if (err.response?.data?.detail) {
        if (Array.isArray(err.response.data.detail)) {
          // FastAPI validation errors
          errorMessage = err.response.data.detail.map((e: any) => e.msg).join(", ")
        } else if (typeof err.response.data.detail === 'string') {
          errorMessage = err.response.data.detail
        }
      } else if (err.message) {
        errorMessage = err.message
      }

      setError(errorMessage)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCardPayment = async () => {
    setIsProcessing(true)
    setError(null)

    try {
      // Get auth token
      const authToken = document.cookie
        .split("; ")
        .find(row => row.startsWith("auth_token="))
        ?.split("=")[1]

      if (!authToken) {
        throw new Error("Authentication required. Please log in.")
      }

      // Create Stripe checkout session
      // Send dollar amount - backend converts to cents
      debugLog("💳 Creating Stripe checkout session for $" + amount)
      const response = await fetch(getAuthBackendUrl("/stripe/top_up"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify({ amount: amount }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Failed to create checkout session: ${response.statusText}`)
      }

      const data = await response.json()
      debugLog("✅ Checkout session created:", data.session_id)

      // Redirect to Stripe checkout
      window.location.href = data.checkout_url

    } catch (err: any) {
      debugLog("❌ Stripe checkout error:", err)
      setError(err.message || "Payment failed. Please try again.")
      setIsProcessing(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (amount < minAmount || amount > maxAmount) {
      setError(`Amount must be between $${minAmount} and $${maxAmount}`)
      return
    }

    if (paymentMethod === "crypto") {
      handleCryptoPayment()
    } else {
      handleCardPayment()
    }
  }

  if (!isOpen) return null

  const modalContent = (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
      onClick={handleClose}
    >
      <div 
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-[26rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-foreground">Top Up Balance</h2>
            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Payment Successful!</h3>
              <p className="text-muted-foreground">Your balance will be updated shortly.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Wallet Notice - only shown for crypto */}
              {paymentMethod === "crypto" && (
                <div className="mb-4 p-3 bg-primary/10 border border-primary/20 rounded-lg text-sm text-foreground">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0 text-primary" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <strong>Note:</strong> If you have both Phantom and MetaMask installed, please disable one of them to avoid payment errors.
                    </div>
                  </div>
                </div>
              )}

              {/* Payment Method Selection */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-foreground mb-3">Payment Method</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handlePaymentMethodChange("card")}
                    disabled={isProcessing}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      paymentMethod === "card"
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-border-medium"
                    } disabled:opacity-50`}
                  >
                    <div className="font-semibold text-foreground">Credit Card</div>
                    <div className="text-xs text-muted-foreground mt-1">Stripe</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePaymentMethodChange("crypto")}
                    disabled={isProcessing}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      paymentMethod === "crypto"
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-border-medium"
                    } disabled:opacity-50`}
                  >
                    <div className="font-semibold text-foreground">Crypto</div>
                    <div className="text-xs text-muted-foreground mt-1">USDC</div>
                  </button>
                </div>
              </div>

              {/* Amount Selection */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-foreground mb-3">
                  Amount: ${amount.toFixed(2)}
                </label>
                
                {!showCustomAmount ? (
                  <>
                    {/* Slider for amounts up to $100 */}
                    <input
                      type="range"
                      min={minAmount}
                      max={sliderMaxAmount}
                      step={paymentMethod === "crypto" ? 0.1 : 1}
                      value={Math.min(amount, sliderMaxAmount)}
                      onChange={(e) => setAmount(parseFloat(e.target.value))}
                      disabled={isProcessing}
                      className="w-full h-3 bg-border rounded-lg appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-2">
                      <span>${minAmount}</span>
                      <span>${sliderMaxAmount}</span>
                    </div>
                    
                    {/* Preset Amount Buttons */}
                    <div className="flex gap-2 mt-3">
                      {[10, 20, 50, 100].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setAmount(preset)}
                          disabled={isProcessing || preset < minAmount}
                          className={`flex-1 py-1.5 text-sm font-medium rounded-md border transition-all cursor-pointer ${
                            amount === preset
                              ? "border-primary bg-primary/20 text-primary"
                              : "border-border hover:border-border-medium text-muted-foreground hover:text-foreground"
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          ${preset}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowCustomAmount(true)}
                        disabled={isProcessing}
                        className="flex-[1.3] py-1.5 text-sm font-medium rounded-md border transition-all border-border hover:border-border-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed text-center cursor-pointer"
                      >
                        Custom
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Custom Amount Input */}
                    <div className="space-y-3">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <input
                          type="number"
                          min={minAmount}
                          max={maxAmount}
                          step="0.01"
                          value={customAmountInput}
                          onChange={(e) => {
                            setCustomAmountInput(e.target.value)
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val) && val >= minAmount && val <= maxAmount) {
                              setAmount(val)
                            }
                          }}
                          onBlur={() => {
                            const val = parseFloat(customAmountInput)
                            if (!isNaN(val)) {
                              const clamped = Math.min(Math.max(val, minAmount), maxAmount)
                              setAmount(clamped)
                              setCustomAmountInput(clamped.toString())
                            }
                          }}
                          placeholder="Enter amount"
                          disabled={isProcessing}
                          className="w-full pl-7 pr-4 py-3 bg-surface-low border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Enter any amount between ${minAmount} and ${maxAmount}
                      </p>
                      
                      {/* Quick presets for larger amounts */}
                      <div className="flex flex-wrap gap-2">
                        {[150, 250, 500, 1000].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              setAmount(preset)
                              setCustomAmountInput(preset.toString())
                            }}
                            disabled={isProcessing}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-all cursor-pointer ${
                              amount === preset
                                ? "border-primary bg-primary/20 text-primary"
                                : "border-border hover:border-border-medium text-muted-foreground hover:text-foreground"
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            ${preset}
                          </button>
                        ))}
                      </div>
                      
                      {/* Back to slider link */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomAmount(false)
                          if (amount > sliderMaxAmount) {
                            setAmount(sliderMaxAmount)
                          }
                          setCustomAmountInput("")
                        }}
                        disabled={isProcessing}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        ← Back to slider
                      </button>
                    </div>
                  </>
                )}
              </div>


              {/* Error Message */}
              {error && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                  {error}
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isProcessing}
                className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-semibold py-3 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors glow-primary"
              >
                {isProcessing ? "Processing..." : `Pay $${amount.toFixed(2)}`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )

  // Use portal to render outside current component tree
  return typeof window !== 'undefined' ? createPortal(modalContent, document.body) : null
}
