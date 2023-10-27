import { BigNumber } from '@ethersproject/bignumber'
import { t, Trans } from '@lingui/macro'
import {
  BrowserEvent,
  InterfaceElementName,
  InterfaceEventName,
  InterfacePageName,
  InterfaceSectionName,
  SharedEventName,
  SwapEventName,
} from '@uniswap/analytics-events'
import { ChainId, Currency, CurrencyAmount, Percent, Token } from '@uniswap/sdk-core'
import { UNIVERSAL_ROUTER_ADDRESS } from '@uniswap/universal-router-sdk'
import { useWeb3React } from '@web3-react/core'
import { sendAnalyticsEvent, Trace, TraceEvent, useTrace } from 'analytics'
import { useToggleAccountDrawer } from 'components/AccountDrawer'
import { ButtonError, ButtonLight, ButtonPrimary } from 'components/Button'
import { GrayCard } from 'components/Card'
import { AutoColumn } from 'components/Column'
import PayCurrencyInputPanel from 'components/CurrencyInputPanel/PayCurrencyInputPanel'
import SwapCurrencyInputPanel from 'components/CurrencyInputPanel/SwapCurrencyInputPanel'
import { NetworkAlert } from 'components/NetworkAlert/NetworkAlert'
import { SearchInput } from 'components/SearchModal/styled'
import confirmPriceImpactWithoutFee from 'components/swap/confirmPriceImpactWithoutFee'
import ConfirmSendModal from 'components/swap/ConfirmSendModal'
import ConfirmSwapModal from 'components/swap/ConfirmSwapModal'
import PriceImpactModal from 'components/swap/PriceImpactModal'
import PriceImpactWarning from 'components/swap/PriceImpactWarning'
import { ArrowWrapper, PageWrapper, SwapWrapper } from 'components/swap/styled'
import SwapDetailsDropdown from 'components/swap/SwapDetailsDropdown'
import SwapHeader, { Tab } from 'components/swap/SwapHeader'
import { SwitchLocaleLink } from 'components/SwitchLocaleLink'
import TokenSafetyModal from 'components/TokenSafety/TokenSafetyModal'
import { useConnectionReady } from 'connection/eagerlyConnect'
import { getChainInfo } from 'constants/chainInfo'
import { asSupportedChain, isSupportedChain } from 'constants/chains'
import { getSwapCurrencyId, TOKEN_SHORTHANDS } from 'constants/tokens'
import { useUniswapXDefaultEnabled } from 'featureFlags/flags/uniswapXDefault'
import { useCurrency, useDefaultActiveTokens } from 'hooks/Tokens'
import { useTokenContract } from 'hooks/useContract'
import useENSAddress from 'hooks/useENSAddress'
import { useIsSwapUnsupported } from 'hooks/useIsSwapUnsupported'
import { useMaxAmountIn } from 'hooks/useMaxAmountIn'
import usePermit2Allowance, { AllowanceState } from 'hooks/usePermit2Allowance'
import usePrevious from 'hooks/usePrevious'
import { SwapResult, useSwapCallback } from 'hooks/useSwapCallback'
import { useSwitchChain } from 'hooks/useSwitchChain'
import { useUSDPrice } from 'hooks/useUSDPrice'
import useWrapCallback, { WrapErrorText, WrapType } from 'hooks/useWrapCallback'
import JSBI from 'jsbi'
import { formatSwapQuoteReceivedEventProperties } from 'lib/utils/analytics'
import { ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ArrowDown } from 'react-feather'
import { useLocation, useNavigate } from 'react-router-dom'
import { Text } from 'rebass'
import { useAppDispatch, useAppSelector } from 'state/hooks'
import { InterfaceTrade, TradeState } from 'state/routing/types'
import { isClassicTrade, isPreviewTrade } from 'state/routing/utils'
import { Field, forceExactInput, replaceSwapState } from 'state/swap/actions'
import { useDefaultsFromURLSearch, useDerivedSwapInfo, useSwapActionHandlers } from 'state/swap/hooks'
import swapReducer, { initialState as initialSwapState, SwapState } from 'state/swap/reducer'
import { addTransaction } from 'state/transactions/reducer'
import { TransactionType } from 'state/transactions/types'
import styled, { useTheme } from 'styled-components'
import { ThemedText } from 'theme/components'
import { maybeLogFirstSwapAction } from 'tracing/swapFlowLoggers'
import { isAddress } from 'utils/addresses'
import { computeFiatValuePriceImpact } from 'utils/computeFiatValuePriceImpact'
import { NumberType, useFormatter } from 'utils/formatNumbers'
import { maxAmountSpend } from 'utils/maxAmountSpend'
import { computeRealizedPriceImpact, warningSeverity } from 'utils/prices'
import { didUserReject } from 'utils/swapErrorToUserReadableMessage'

import { useScreenSize } from '../../hooks/useScreenSize'
import { useIsDarkMode } from '../../theme/components/ThemeToggle'
import { OutputTaxTooltipBody } from './TaxTooltipBody'
import { UniswapXOptIn } from './UniswapXOptIn'

export type ResolvedRecipient = {
  recipient?: string
  originalRecipient?: string
  type: 'eth' | 'venmo'
}

const PYUSD = new Token(ChainId.MAINNET, '0x6c3ea9036406852006290770bedfcaba0e23a0e8', 6, 'PYUSD', 'PayPal USD')

export const ArrowContainer = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;

  width: 100%;
  height: 100%;
`

const SwapSection = styled.div`
  background-color: ${({ theme }) => theme.surface2};
  border-radius: 16px;
  color: ${({ theme }) => theme.neutral2};
  font-size: 14px;
  font-weight: 500;
  height: 120px;
  line-height: 20px;
  padding: 16px;
  position: relative;

  &:before {
    box-sizing: border-box;
    background-size: 100%;
    border-radius: inherit;

    position: absolute;
    top: 0;
    left: 0;

    width: 100%;
    height: 100%;
    pointer-events: none;
    content: '';
    border: 1px solid ${({ theme }) => theme.surface2};
  }

  &:hover:before {
    border-color: ${({ theme }) => theme.deprecated_stateOverlayHover};
  }

  &:focus-within:before {
    border-color: ${({ theme }) => theme.deprecated_stateOverlayPressed};
  }
`

const OutputSwapSection = styled(SwapSection)`
  border-bottom: ${({ theme }) => `1px solid ${theme.surface1}`};
`
const RecipientSection = styled(SwapSection)`
  border-bottom: ${({ theme }) => `1px solid ${theme.surface1}`};
  display: flex;
  align-items: center;
  justify-content: center;
`

export const RecipientInput = styled(SearchInput)`
  background-image: none;
  outline: none;
  border: none;
  :focus {
    border: none;
  }
`

function getIsReviewableQuote(
  trade: InterfaceTrade | undefined,
  tradeState: TradeState,
  swapInputError?: ReactNode
): boolean {
  if (swapInputError) return false
  // if the current quote is a preview quote, allow the user to progress to the Swap review screen
  if (isPreviewTrade(trade)) return true

  return Boolean(trade && tradeState === TradeState.VALID)
}

function largerPercentValue(a?: Percent, b?: Percent) {
  if (a && b) {
    return a.greaterThan(b) ? a : b
  } else if (a) {
    return a
  } else if (b) {
    return b
  }
  return undefined
}

export default function SwapPage({ className }: { className?: string }) {
  const { chainId: connectedChainId } = useWeb3React()
  const loadedUrlParams = useDefaultsFromURLSearch()

  const location = useLocation()

  const supportedChainId = asSupportedChain(connectedChainId)

  return (
    <Trace page={InterfacePageName.SWAP_PAGE} shouldLogImpression>
      <PageWrapper>
        <Swap
          className={className}
          chainId={supportedChainId ?? ChainId.MAINNET}
          initialInputCurrencyId={loadedUrlParams?.[Field.INPUT]?.currencyId}
          initialOutputCurrencyId={loadedUrlParams?.[Field.OUTPUT]?.currencyId}
          disableTokenInputs={supportedChainId === undefined}
        />
        <NetworkAlert />
      </PageWrapper>
      {location.pathname === '/swap' && <SwitchLocaleLink />}
    </Trace>
  )
}

/**
 * The swap component displays the swap interface, manages state for the swap, and triggers onchain swaps.
 *
 * In most cases, chainId should refer to the connected chain, i.e. `useWeb3React().chainId`.
 * However if this component is being used in a context that displays information from a different, unconnected
 * chain (e.g. the TDP), then chainId should refer to the unconnected chain.
 */
export function Swap({
  className,
  initialInputCurrencyId,
  initialOutputCurrencyId,
  chainId,
  onCurrencyChange,
  disableTokenInputs = false,
}: {
  className?: string
  initialInputCurrencyId?: string | null
  initialOutputCurrencyId?: string | null
  chainId?: ChainId
  onCurrencyChange?: (selected: Pick<SwapState, Field.INPUT | Field.OUTPUT>) => void
  disableTokenInputs?: boolean
}) {
  const connectionReady = useConnectionReady()
  const { account, chainId: connectedChainId, connector, provider } = useWeb3React()
  const trace = useTrace()
  const [showSendConfirm, setShowSendConfirm] = useState(false)
  const [sendTxHash, setSendTxHash] = useState<string>()
  const [recipientAddress, setRecipientAddress] = useState<string>()

  // token warning stuff
  const prefilledInputCurrency = useCurrency(initialInputCurrencyId, chainId)
  const prefilledOutputCurrency = useCurrency(initialOutputCurrencyId, chainId)

  const [loadedInputCurrency, setLoadedInputCurrency] = useState(prefilledInputCurrency)
  const [loadedOutputCurrency, setLoadedOutputCurrency] = useState(prefilledOutputCurrency)

  useEffect(() => {
    setLoadedInputCurrency(prefilledInputCurrency)
    setLoadedOutputCurrency(prefilledOutputCurrency)
  }, [prefilledInputCurrency, prefilledOutputCurrency])

  const [dismissTokenWarning, setDismissTokenWarning] = useState<boolean>(false)
  const [showPriceImpactModal, setShowPriceImpactModal] = useState<boolean>(false)

  const urlLoadedTokens: Token[] = useMemo(
    () => [loadedInputCurrency, loadedOutputCurrency]?.filter((c): c is Token => c?.isToken ?? false) ?? [],
    [loadedInputCurrency, loadedOutputCurrency]
  )
  const handleConfirmTokenWarning = useCallback(() => {
    setDismissTokenWarning(true)
  }, [])

  // dismiss warning if all imported tokens are in active lists
  const defaultTokens = useDefaultActiveTokens(chainId)
  const importTokensNotInDefault = useMemo(
    () =>
      urlLoadedTokens &&
      urlLoadedTokens
        .filter((token: Token) => {
          return !(token.address in defaultTokens)
        })
        .filter((token: Token) => {
          // Any token addresses that are loaded from the shorthands map do not need to show the import URL
          const supported = asSupportedChain(chainId)
          if (!supported) return true
          return !Object.keys(TOKEN_SHORTHANDS).some((shorthand) => {
            const shorthandTokenAddress = TOKEN_SHORTHANDS[shorthand][supported]
            return shorthandTokenAddress && shorthandTokenAddress === token.address
          })
        }),
    [chainId, defaultTokens, urlLoadedTokens]
  )

  const theme = useTheme()

  // toggle wallet when disconnected
  const toggleWalletDrawer = useToggleAccountDrawer()

  const PYUSD_ADDRESS = '0x6c3ea9036406852006290770bedfcaba0e23a0e8'

  // swap state
  const prefilledState = useMemo(
    () => ({
      [Field.INPUT]: { currencyId: initialInputCurrencyId },
      [Field.OUTPUT]: { currencyId: PYUSD_ADDRESS },
    }),
    [initialInputCurrencyId]
  )
  const [state, dispatch] = useReducer(swapReducer, { ...initialSwapState, ...prefilledState })
  const appDispatch = useAppDispatch()
  const { typedValue, independentField } = state
  const { loading, address: ensResolution } = useENSAddress(recipientAddress)

  const previousConnectedChainId = usePrevious(connectedChainId)
  const previousPrefilledState = usePrevious(prefilledState)
  useEffect(() => {
    const combinedInitialState = { ...initialSwapState, ...prefilledState }
    const chainChanged = previousConnectedChainId && previousConnectedChainId !== connectedChainId
    const prefilledInputChanged =
      previousPrefilledState &&
      previousPrefilledState?.[Field.INPUT]?.currencyId !== prefilledState?.[Field.INPUT]?.currencyId
    const prefilledOutputChanged =
      previousPrefilledState &&
      previousPrefilledState?.[Field.OUTPUT]?.currencyId !== prefilledState?.[Field.OUTPUT]?.currencyId
    if (chainChanged || prefilledInputChanged || prefilledOutputChanged) {
      dispatch(
        replaceSwapState({
          ...initialSwapState,
          ...prefilledState,
          field: combinedInitialState.independentField ?? Field.INPUT,
          inputCurrencyId: combinedInitialState.INPUT.currencyId ?? undefined,
          outputCurrencyId: combinedInitialState.OUTPUT.currencyId ?? undefined,
        })
      )
      // reset local state
      setSwapState({
        tradeToConfirm: undefined,
        swapError: undefined,
        showConfirm: false,
        swapResult: undefined,
      })
    }
  }, [connectedChainId, prefilledState, previousConnectedChainId, previousPrefilledState])

  const swapInfo = useDerivedSwapInfo(state, chainId)
  const {
    trade: { state: tradeState, trade, swapQuoteLatency },
    allowedSlippage,
    autoSlippage,
    currencyBalances,
    parsedAmount,
    currencies,
    inputError: swapInputError,
    inputTax,
    outputTax,
    outputFeeFiatValue,
  } = swapInfo

  const [inputTokenHasTax, outputTokenHasTax] = useMemo(
    () => [!inputTax.equalTo(0), !outputTax.equalTo(0)],
    [inputTax, outputTax]
  )

  useEffect(() => {
    // Force exact input if the user switches to an output token with tax
    if (outputTokenHasTax && independentField === Field.OUTPUT) dispatch(forceExactInput())
  }, [independentField, outputTokenHasTax, trade?.outputAmount])

  const {
    wrapType,
    execute: onWrap,
    inputError: wrapInputError,
  } = useWrapCallback(currencies[Field.INPUT], currencies[Field.OUTPUT], typedValue)
  const showWrap: boolean = wrapType !== WrapType.NOT_APPLICABLE

  const parsedAmounts = useMemo(
    () =>
      showWrap
        ? {
            [Field.INPUT]: parsedAmount,
            [Field.OUTPUT]: parsedAmount,
          }
        : {
            [Field.INPUT]: independentField === Field.INPUT ? parsedAmount : trade?.inputAmount,
            [Field.OUTPUT]: independentField === Field.OUTPUT ? parsedAmount : trade?.postTaxOutputAmount,
          },
    [independentField, parsedAmount, showWrap, trade]
  )

  const showFiatValueInput = Boolean(parsedAmounts[Field.INPUT])
  const showFiatValueOutput = Boolean(parsedAmounts[Field.OUTPUT])
  const getSingleUnitAmount = (currency?: Currency) => {
    if (!currency) return
    return CurrencyAmount.fromRawAmount(currency, JSBI.BigInt(10 ** currency.decimals))
  }

  const fiatValueInput = useUSDPrice(
    parsedAmounts[Field.INPUT] ?? getSingleUnitAmount(currencies[Field.INPUT]),
    currencies[Field.INPUT]
  )
  const fiatValueOutput = useUSDPrice(
    parsedAmounts[Field.OUTPUT] ?? getSingleUnitAmount(currencies[Field.OUTPUT]),
    currencies[Field.OUTPUT]
  )

  const [routeNotFound, routeIsLoading, routeIsSyncing] = useMemo(
    () => [
      tradeState === TradeState.NO_ROUTE_FOUND,
      tradeState === TradeState.LOADING,
      tradeState === TradeState.LOADING && Boolean(trade),
    ],
    [trade, tradeState]
  )

  const fiatValueTradeInput = useUSDPrice(trade?.inputAmount)
  const fiatValueTradeOutput = useUSDPrice(trade?.postTaxOutputAmount)
  const preTaxFiatValueTradeOutput = useUSDPrice(trade?.outputAmount)
  const [stablecoinPriceImpact, preTaxStablecoinPriceImpact] = useMemo(
    () =>
      routeIsSyncing || !isClassicTrade(trade)
        ? [undefined, undefined]
        : [
            computeFiatValuePriceImpact(fiatValueTradeInput.data, fiatValueTradeOutput.data),
            computeFiatValuePriceImpact(fiatValueTradeInput.data, preTaxFiatValueTradeOutput.data),
          ],
    [fiatValueTradeInput, fiatValueTradeOutput, preTaxFiatValueTradeOutput, routeIsSyncing, trade]
  )

  const { onSwitchTokens, onCurrencySelection, onUserInput } = useSwapActionHandlers(dispatch)
  const dependentField: Field = independentField === Field.INPUT ? Field.OUTPUT : Field.INPUT

  const handleTypeInput = useCallback(
    (value: string) => {
      onUserInput(Field.INPUT, value)
      maybeLogFirstSwapAction(trace)
    },
    [onUserInput, trace]
  )
  const handleTypeOutput = useCallback(
    (value: string) => {
      onUserInput(Field.OUTPUT, value)
      maybeLogFirstSwapAction(trace)
    },
    [onUserInput, trace]
  )

  const navigate = useNavigate()
  const swapIsUnsupported = useIsSwapUnsupported(currencies[Field.INPUT], currencies[Field.OUTPUT])

  // reset if they close warning without tokens in params
  const handleDismissTokenWarning = useCallback(() => {
    setDismissTokenWarning(true)
    navigate('/swap/')
  }, [navigate])

  // modal and loading
  const [{ showConfirm, tradeToConfirm, swapError, swapResult }, setSwapState] = useState<{
    showConfirm: boolean
    tradeToConfirm?: InterfaceTrade
    swapError?: Error
    swapResult?: SwapResult
  }>({
    showConfirm: false,
    tradeToConfirm: undefined,
    swapError: undefined,
    swapResult: undefined,
  })

  const { formatCurrencyAmount } = useFormatter()
  const formattedAmounts = useMemo(
    () => ({
      [independentField]: typedValue,
      [dependentField]: showWrap
        ? parsedAmounts[independentField]?.toExact() ?? ''
        : formatCurrencyAmount({
            amount: parsedAmounts[dependentField],
            type: NumberType.SwapTradeAmount,
            placeholder: '',
          }),
    }),
    [dependentField, formatCurrencyAmount, independentField, parsedAmounts, showWrap, typedValue]
  )

  const userHasSpecifiedInputOutput = Boolean(
    currencies[Field.INPUT] && currencies[Field.OUTPUT] && parsedAmounts[independentField]?.greaterThan(JSBI.BigInt(0))
  )

  const maximumAmountIn = useMaxAmountIn(trade, allowedSlippage)
  const allowance = usePermit2Allowance(
    maximumAmountIn ??
      (parsedAmounts[Field.INPUT]?.currency.isToken
        ? (parsedAmounts[Field.INPUT] as CurrencyAmount<Token>)
        : undefined),
    isSupportedChain(chainId) ? UNIVERSAL_ROUTER_ADDRESS(chainId) : undefined,
    trade?.fillType
  )

  const maxInputAmount: CurrencyAmount<Currency> | undefined = useMemo(
    () => maxAmountSpend(currencyBalances[Field.INPUT]),
    [currencyBalances]
  )
  const showMaxButton = Boolean(maxInputAmount?.greaterThan(0) && !parsedAmounts[Field.INPUT]?.equalTo(maxInputAmount))
  const swapFiatValues = useMemo(() => {
    return { amountIn: fiatValueTradeInput.data, amountOut: fiatValueTradeOutput.data, feeUsd: outputFeeFiatValue }
  }, [fiatValueTradeInput.data, fiatValueTradeOutput.data, outputFeeFiatValue])

  const [selectedTabIndex, setSelectedTabIndex] = useState(Tab.SWAP)
  const resolvedRecipient: ResolvedRecipient | undefined = useMemo(() => {
    const address = isAddress(recipientAddress)
    if (address) {
      return { recipient: address || undefined, originalRecipient: recipientAddress || undefined, type: 'eth' }
    } else if (!loading && ensResolution) {
      return { recipient: ensResolution || undefined, type: 'eth', originalRecipient: recipientAddress || undefined }
    } else if (recipientAddress?.startsWith('@') && recipientAddress?.length > 1) {
      // hard-coded recipient for @Edward-Dugan on venmo
      return {
        recipient: '0xe38731ceaCAB9d4cBb97f0A0448ACe3a201DF9dA',
        type: 'venmo',
        originalRecipient: recipientAddress || undefined,
      }
    }
    return undefined
  }, [ensResolution, loading, recipientAddress])

  // the callback to execute the swap
  const swapCallback = useSwapCallback(
    trade,
    swapFiatValues,
    allowedSlippage,
    allowance.state === AllowanceState.ALLOWED ? allowance.permitSignature : undefined,
    selectedTabIndex === Tab.PAY && trade?.outputAmount.currency && PYUSD.equals(trade?.outputAmount.currency)
      ? resolvedRecipient?.recipient
      : undefined
  )

  const handleContinueToReview = useCallback(() => {
    setSwapState({
      tradeToConfirm: trade,
      swapError: undefined,
      showConfirm: true,
      swapResult: undefined,
    })
  }, [trade])

  const clearSwapState = useCallback(() => {
    setSwapState((currentState) => ({
      ...currentState,
      swapError: undefined,
      swapResult: undefined,
    }))
  }, [])

  const sendTokenAddress = currencies[Field.INPUT]?.isToken ? currencies[Field.INPUT]?.address : 'native_eth'
  const contract = useTokenContract(sendTokenAddress, true /* withSignerIfPossible */)

  const handleSwap = useCallback(() => {
    if (!swapCallback) {
      return
    }
    if (preTaxStablecoinPriceImpact && !confirmPriceImpactWithoutFee(preTaxStablecoinPriceImpact)) {
      return
    }
    return swapCallback()
      .then((result) => {
        setSwapState((currentState) => ({
          ...currentState,
          swapError: undefined,
          swapResult: result,
        }))
      })
      .catch((error) => {
        setSwapState((currentState) => ({
          ...currentState,
          swapError: error,
          swapResult: undefined,
        }))
      })
  }, [swapCallback, preTaxStablecoinPriceImpact])

  const handleSendEth = useCallback(async () => {
    // send ETH
    const value = BigNumber.from(trade?.inputAmount.quotient.toString())
    const tx = await provider?.getSigner().sendTransaction({
      to: resolvedRecipient?.recipient || '',
      value: BigNumber.from(value),
    })
    if (tx && account && chainId) {
      setSendTxHash(tx.hash)
      appDispatch(
        addTransaction({
          hash: tx.hash,
          from: account,
          info: {
            type: TransactionType.SEND,
            recipient: resolvedRecipient?.recipient || '',
            currencyAmountRaw: value.toString(),
          },
          chainId,
          nonce: tx.nonce,
        })
      )
    }
  }, [account, appDispatch, chainId, provider, resolvedRecipient?.recipient, trade?.inputAmount.quotient])

  const handleSendToken = useCallback(async () => {
    // send token
    const value = BigNumber.from(trade?.inputAmount.quotient.toString())
    const tx = await contract?.transfer(resolvedRecipient?.recipient || '', value)
    if (tx && account && chainId) {
      setSendTxHash(tx?.hash)
      appDispatch(
        addTransaction({
          hash: tx.hash,
          from: account,
          info: {
            type: TransactionType.SEND,
            recipient: resolvedRecipient?.recipient || '',
            currencyAmountRaw: value.toString(),
          },
          chainId,
          nonce: tx.nonce,
        })
      )
    }
  }, [account, appDispatch, chainId, contract, resolvedRecipient?.recipient, trade?.inputAmount.quotient])

  const handleSend = useCallback(() => {
    if (resolvedRecipient?.type === 'venmo' && trade?.inputAmount.currency) {
      if (PYUSD.equals(trade?.inputAmount.currency)) {
        handleSendToken()
      } else {
        // TODO: trigger venmo transfer
        handleSwap()?.then(() => console.log('HERE'))
      }
    } else {
      if (trade?.inputAmount.currency.isToken) {
        handleSendToken()
      } else {
        handleSendEth()
      }
    }
  }, [handleSendEth, handleSendToken, handleSwap, resolvedRecipient?.type, trade?.inputAmount.currency])

  const handleOnWrap = useCallback(async () => {
    if (!onWrap) return
    try {
      const txHash = await onWrap()
      setSwapState((currentState) => ({
        ...currentState,
        swapError: undefined,
        txHash,
      }))
      onUserInput(Field.INPUT, '')
    } catch (error) {
      if (!didUserReject(error)) {
        sendAnalyticsEvent(SwapEventName.SWAP_ERROR, {
          wrapType,
          input: currencies[Field.INPUT],
          output: currencies[Field.OUTPUT],
        })
      }
      console.error('Could not wrap/unwrap', error)
      setSwapState((currentState) => ({
        ...currentState,
        swapError: error,
        txHash: undefined,
      }))
    }
  }, [currencies, onUserInput, onWrap, wrapType])

  // warnings on the greater of fiat value price impact and execution price impact
  const { priceImpactSeverity, largerPriceImpact } = useMemo(() => {
    if (!isClassicTrade(trade)) {
      return { priceImpactSeverity: 0, largerPriceImpact: undefined }
    }

    const marketPriceImpact = trade?.priceImpact ? computeRealizedPriceImpact(trade) : undefined
    const largerPriceImpact = largerPercentValue(marketPriceImpact, preTaxStablecoinPriceImpact)
    return { priceImpactSeverity: warningSeverity(largerPriceImpact), largerPriceImpact }
  }, [preTaxStablecoinPriceImpact, trade])

  const handleConfirmDismiss = useCallback(() => {
    setSwapState((currentState) => ({ ...currentState, showConfirm: false }))
    // If there was a swap, we want to clear the input
    if (swapResult) {
      onUserInput(Field.INPUT, '')
    }
  }, [onUserInput, swapResult])

  const handleAcceptChanges = useCallback(() => {
    setSwapState((currentState) => ({ ...currentState, tradeToConfirm: trade }))
  }, [trade])

  const handleInputSelect = useCallback(
    (inputCurrency: Currency) => {
      onCurrencySelection(Field.INPUT, inputCurrency)
      onCurrencyChange?.({
        [Field.INPUT]: {
          currencyId: getSwapCurrencyId(inputCurrency),
        },
        [Field.OUTPUT]: state[Field.OUTPUT],
      })
      maybeLogFirstSwapAction(trace)
    },
    [onCurrencyChange, onCurrencySelection, state, trace]
  )
  const inputCurrencyNumericalInputRef = useRef<HTMLInputElement>(null)

  const handleMaxInput = useCallback(() => {
    maxInputAmount && onUserInput(Field.INPUT, maxInputAmount.toExact())
    maybeLogFirstSwapAction(trace)
  }, [maxInputAmount, onUserInput, trace])

  const handleOutputSelect = useCallback(
    (outputCurrency: Currency) => {
      onCurrencySelection(Field.OUTPUT, outputCurrency)
      onCurrencyChange?.({
        [Field.INPUT]: state[Field.INPUT],
        [Field.OUTPUT]: {
          currencyId: getSwapCurrencyId(outputCurrency),
        },
      })
      maybeLogFirstSwapAction(trace)
    },
    [onCurrencyChange, onCurrencySelection, state, trace]
  )

  const showPriceImpactWarning = isClassicTrade(trade) && largerPriceImpact && priceImpactSeverity > 3

  const prevTrade = usePrevious(trade)
  useEffect(() => {
    if (!trade || prevTrade === trade) return // no new swap quote to log

    sendAnalyticsEvent(SwapEventName.SWAP_QUOTE_RECEIVED, {
      ...formatSwapQuoteReceivedEventProperties(
        trade,
        allowedSlippage,
        swapQuoteLatency,
        inputTax,
        outputTax,
        outputFeeFiatValue
      ),
      ...trace,
    })
  }, [prevTrade, trade, trace, allowedSlippage, swapQuoteLatency, inputTax, outputTax, outputFeeFiatValue])

  const showDetailsDropdown = Boolean(
    !showWrap && userHasSpecifiedInputOutput && (trade || routeIsLoading || routeIsSyncing)
  )

  const inputCurrency = currencies[Field.INPUT] ?? undefined
  const switchChain = useSwitchChain()
  const switchingChain = useAppSelector((state) => state.wallets.switchingChain)
  const showOptInSmall = !useScreenSize().navSearchInputVisible
  const isDark = useIsDarkMode()
  const isUniswapXDefaultEnabled = useUniswapXDefaultEnabled()

  const swapElement = (
    <SwapWrapper isDark={isDark} className={className} id="swap-page">
      <TokenSafetyModal
        isOpen={importTokensNotInDefault.length > 0 && !dismissTokenWarning}
        tokenAddress={importTokensNotInDefault[0]?.address}
        secondTokenAddress={importTokensNotInDefault[1]?.address}
        onContinue={handleConfirmTokenWarning}
        onCancel={handleDismissTokenWarning}
        showCancel={true}
      />
      <SwapHeader
        selectedTabIndex={selectedTabIndex}
        setSelectedTabIndex={setSelectedTabIndex}
        trade={trade}
        autoSlippage={autoSlippage}
        chainId={chainId}
      />
      {trade && showConfirm && (
        <ConfirmSwapModal
          trade={trade}
          inputCurrency={inputCurrency}
          originalTrade={tradeToConfirm}
          onAcceptChanges={handleAcceptChanges}
          onCurrencySelection={onCurrencySelection}
          swapResult={swapResult}
          allowedSlippage={allowedSlippage}
          clearSwapState={clearSwapState}
          onConfirm={handleSwap}
          allowance={allowance}
          swapError={swapError}
          onDismiss={handleConfirmDismiss}
          fiatValueInput={fiatValueTradeInput}
          fiatValueOutput={fiatValueTradeOutput}
        />
      )}
      {showPriceImpactModal && showPriceImpactWarning && (
        <PriceImpactModal
          priceImpact={largerPriceImpact}
          onDismiss={() => setShowPriceImpactModal(false)}
          onContinue={() => {
            setShowPriceImpactModal(false)
            handleContinueToReview()
          }}
        />
      )}

      <div style={{ display: 'relative' }}>
        <SwapSection>
          <Trace section={InterfaceSectionName.CURRENCY_INPUT_PANEL}>
            <SwapCurrencyInputPanel
              label={<Trans>You pay</Trans>}
              disabled={disableTokenInputs}
              value={formattedAmounts[Field.INPUT]}
              showMaxButton={showMaxButton}
              currency={currencies[Field.INPUT] ?? null}
              onUserInput={handleTypeInput}
              onMax={handleMaxInput}
              fiatValue={showFiatValueInput ? fiatValueInput : undefined}
              onCurrencySelect={handleInputSelect}
              otherCurrency={currencies[Field.OUTPUT]}
              showCommonBases
              id={InterfaceSectionName.CURRENCY_INPUT_PANEL}
              loading={independentField === Field.OUTPUT && routeIsSyncing}
              ref={inputCurrencyNumericalInputRef}
            />
          </Trace>
        </SwapSection>
        <ArrowWrapper clickable={isSupportedChain(chainId)}>
          <TraceEvent
            events={[BrowserEvent.onClick]}
            name={SwapEventName.SWAP_TOKENS_REVERSED}
            element={InterfaceElementName.SWAP_TOKENS_REVERSE_ARROW_BUTTON}
          >
            <ArrowContainer
              data-testid="swap-currency-button"
              onClick={() => {
                if (disableTokenInputs) return
                onSwitchTokens(inputTokenHasTax, formattedAmounts[dependentField])
                maybeLogFirstSwapAction(trace)
              }}
              color={theme.neutral1}
            >
              <ArrowDown size="16" color={theme.neutral1} />
            </ArrowContainer>
          </TraceEvent>
        </ArrowWrapper>
      </div>
      <AutoColumn gap="xs">
        <div>
          <OutputSwapSection>
            <Trace section={InterfaceSectionName.CURRENCY_OUTPUT_PANEL}>
              <SwapCurrencyInputPanel
                value={formattedAmounts[Field.OUTPUT]}
                disabled={disableTokenInputs}
                onUserInput={handleTypeOutput}
                label={<Trans>You receive</Trans>}
                showMaxButton={false}
                hideBalance={false}
                fiatValue={showFiatValueOutput ? fiatValueOutput : undefined}
                priceImpact={stablecoinPriceImpact}
                currency={currencies[Field.OUTPUT] ?? null}
                onCurrencySelect={handleOutputSelect}
                otherCurrency={currencies[Field.INPUT]}
                showCommonBases
                id={InterfaceSectionName.CURRENCY_OUTPUT_PANEL}
                loading={independentField === Field.INPUT && routeIsSyncing}
                numericalInputSettings={{
                  // We disable numerical input here if the selected token has tax, since we cannot guarantee exact_outputs for FOT tokens
                  disabled: outputTokenHasTax,
                  // Focus the input currency panel if the user tries to type into the disabled output currency panel
                  onDisabledClick: () => inputCurrencyNumericalInputRef.current?.focus(),
                  disabledTooltipBody: <OutputTaxTooltipBody currencySymbol={currencies[Field.OUTPUT]?.symbol} />,
                }}
              />
            </Trace>
          </OutputSwapSection>
        </div>
        {showDetailsDropdown && (
          <SwapDetailsDropdown
            trade={trade}
            syncing={routeIsSyncing}
            loading={routeIsLoading}
            allowedSlippage={allowedSlippage}
          />
        )}
        {showPriceImpactWarning && <PriceImpactWarning priceImpact={largerPriceImpact} />}
        <div>
          {swapIsUnsupported ? (
            <ButtonPrimary $borderRadius="16px" disabled={true}>
              <ThemedText.DeprecatedMain mb="4px">
                <Trans>Unsupported asset</Trans>
              </ThemedText.DeprecatedMain>
            </ButtonPrimary>
          ) : switchingChain ? (
            <ButtonPrimary $borderRadius="16px" disabled={true}>
              <Trans>Connecting to {getChainInfo(switchingChain)?.label}</Trans>
            </ButtonPrimary>
          ) : connectionReady && !account ? (
            <TraceEvent
              events={[BrowserEvent.onClick]}
              name={InterfaceEventName.CONNECT_WALLET_BUTTON_CLICKED}
              properties={{ received_swap_quote: getIsReviewableQuote(trade, tradeState, swapInputError) }}
              element={InterfaceElementName.CONNECT_WALLET_BUTTON}
            >
              <ButtonLight onClick={toggleWalletDrawer} fontWeight={535} $borderRadius="16px">
                <Trans>Connect wallet</Trans>
              </ButtonLight>
            </TraceEvent>
          ) : chainId && chainId !== connectedChainId ? (
            <ButtonPrimary
              $borderRadius="16px"
              onClick={async () => {
                try {
                  await switchChain(connector, chainId)
                } catch (error) {
                  if (didUserReject(error)) {
                    // Ignore error, which keeps the user on the previous chain.
                  } else {
                    // TODO(WEB-3306): This UX could be improved to show an error state.
                    throw error
                  }
                }
              }}
            >
              Connect to {getChainInfo(chainId)?.label}
            </ButtonPrimary>
          ) : showWrap ? (
            <ButtonPrimary
              $borderRadius="16px"
              disabled={Boolean(wrapInputError)}
              onClick={handleOnWrap}
              fontWeight={535}
              data-testid="wrap-button"
            >
              {wrapInputError ? (
                <WrapErrorText wrapInputError={wrapInputError} />
              ) : wrapType === WrapType.WRAP ? (
                <Trans>Wrap</Trans>
              ) : wrapType === WrapType.UNWRAP ? (
                <Trans>Unwrap</Trans>
              ) : null}
            </ButtonPrimary>
          ) : routeNotFound && userHasSpecifiedInputOutput && !routeIsLoading && !routeIsSyncing ? (
            <GrayCard style={{ textAlign: 'center' }}>
              <ThemedText.DeprecatedMain mb="4px">
                <Trans>Insufficient liquidity for this trade.</Trans>
              </ThemedText.DeprecatedMain>
            </GrayCard>
          ) : (
            <TraceEvent
              events={[BrowserEvent.onClick]}
              name={SharedEventName.ELEMENT_CLICKED}
              element={InterfaceElementName.SWAP_BUTTON}
            >
              <ButtonError
                onClick={() => {
                  showPriceImpactWarning ? setShowPriceImpactModal(true) : handleContinueToReview()
                }}
                id="swap-button"
                data-testid="swap-button"
                disabled={!getIsReviewableQuote(trade, tradeState, swapInputError)}
                error={!swapInputError && priceImpactSeverity > 2 && allowance.state === AllowanceState.ALLOWED}
              >
                <Text fontSize={20}>
                  {swapInputError ? (
                    swapInputError
                  ) : routeIsSyncing || routeIsLoading ? (
                    <Trans>Swap</Trans>
                  ) : priceImpactSeverity > 2 ? (
                    <Trans>Swap anyway</Trans>
                  ) : (
                    <Trans>Swap</Trans>
                  )}
                </Text>
              </ButtonError>
            </TraceEvent>
          )}
        </div>
      </AutoColumn>
      {!showOptInSmall && !isUniswapXDefaultEnabled && <UniswapXOptIn isSmall={false} swapInfo={swapInfo} />}
    </SwapWrapper>
  )

  const payElement = (
    <SwapWrapper isDark={isDark} className={className} id="swap-page">
      <SwapHeader
        selectedTabIndex={selectedTabIndex}
        setSelectedTabIndex={setSelectedTabIndex}
        trade={trade}
        autoSlippage={autoSlippage}
        chainId={chainId}
      />
      {trade && showConfirm && (
        <ConfirmSwapModal
          trade={trade}
          inputCurrency={inputCurrency}
          originalTrade={tradeToConfirm}
          onAcceptChanges={handleAcceptChanges}
          onCurrencySelection={onCurrencySelection}
          swapResult={swapResult}
          allowedSlippage={allowedSlippage}
          clearSwapState={clearSwapState}
          onConfirm={handleSwap}
          allowance={allowance}
          swapError={swapError}
          onDismiss={handleConfirmDismiss}
          fiatValueInput={fiatValueTradeInput}
          fiatValueOutput={fiatValueTradeOutput}
        />
      )}
      {resolvedRecipient && trade?.inputAmount && showSendConfirm && (
        <ConfirmSendModal
          trade={trade}
          recipient={resolvedRecipient}
          inputAmount={trade?.inputAmount}
          onConfirm={handleSend}
          onDismiss={() => {
            setSendTxHash(undefined)
            setShowSendConfirm(false)
          }}
          fiatValueInput={fiatValueInput}
          sendTxHash={sendTxHash}
        />
      )}
      {showPriceImpactModal && showPriceImpactWarning && (
        <PriceImpactModal
          priceImpact={largerPriceImpact}
          onDismiss={() => setShowPriceImpactModal(false)}
          onContinue={() => {
            setShowPriceImpactModal(false)
            handleContinueToReview()
          }}
        />
      )}
      <AutoColumn gap="xs">
        <div style={{ display: 'relative' }}>
          <SwapSection>
            <Trace section={InterfaceSectionName.CURRENCY_INPUT_PANEL}>
              <PayCurrencyInputPanel
                label={<Trans>You pay</Trans>}
                disabled={disableTokenInputs}
                value={formattedAmounts[Field.OUTPUT]}
                showMaxButton={showMaxButton}
                currency={currencies[Field.INPUT] ?? null}
                onUserInput={handleTypeOutput}
                onMax={handleMaxInput}
                fiatValue={{ data: trade?.inputAmount, isLoading: false }}
                onCurrencySelect={handleInputSelect}
                otherCurrency={currencies[Field.OUTPUT]}
                showCommonBases
                id={InterfaceSectionName.CURRENCY_INPUT_PANEL}
                loading={independentField === Field.OUTPUT && routeIsSyncing}
                ref={inputCurrencyNumericalInputRef}
              />
            </Trace>
          </SwapSection>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <RecipientSection>
            <RecipientInput
              type="text"
              id="reciptient-search-input"
              placeholder={t`Enter recipient address`}
              autoComplete="off"
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
            />
          </RecipientSection>
        </div>
        <div>
          <ButtonError
            onClick={() => {
              setShowSendConfirm(true)
            }}
            disabled={!resolvedRecipient || !trade}
          >
            <Text fontSize={20}>Pay</Text>
          </ButtonError>
        </div>
      </AutoColumn>
      {!showOptInSmall && !isUniswapXDefaultEnabled && <UniswapXOptIn isSmall={false} swapInfo={swapInfo} />}
    </SwapWrapper>
  )

  return (
    <>
      {selectedTabIndex === Tab.SWAP && swapElement}
      {selectedTabIndex === Tab.PAY && payElement}
      {showOptInSmall && !isUniswapXDefaultEnabled && <UniswapXOptIn isSmall swapInfo={swapInfo} />}
    </>
  )
}
