import { Trans } from '@lingui/macro'
import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import VenmoLogo from 'assets/images/venmo_app_icon.png'
import { ButtonError } from 'components/Button'
import { AutoColumn } from 'components/Column'
import Modal, { MODAL_TRANSITION_DURATION } from 'components/Modal'
import { ConfirmationModalContent } from 'components/TransactionConfirmationModal'
import { ResolvedRecipient } from 'pages/Swap'
import { useCallback, useState } from 'react'
import { Text } from 'rebass'
import { InterfaceTrade } from 'state/routing/types'
import styled from 'styled-components'
import { ThemedText } from 'theme/components'
import { formatCurrencyAmount } from 'utils/formatCurrencyAmount'
import { didUserReject } from 'utils/swapErrorToUserReadableMessage'

import { ConfirmModalState } from './ConfirmSwapModal'
import { PendingConfirmModalState, PendingModalContent } from './PendingModalContent'
import { PendingModalError } from './PendingModalContent/ErrorModalContent'

const Wrapper = styled.div`
  width: 100%;
  height: 100%;
  margin: 24px 0px;
`
const Logo = styled.span`
  background: url(${VenmoLogo});
  background-size: contain;
  background-repeat: no-repeat;
  width: 80px;
  height: 80px;
  overflow: hidden;
`

function useConfirmModalState({ onSend }: { onSend: () => void; inputCurrency: Currency }) {
  const [confirmModalState, setConfirmModalState] = useState<ConfirmModalState>(ConfirmModalState.REVIEWING)
  const [approvalError, setApprovalError] = useState<PendingModalError>()
  const [pendingModalSteps, setPendingModalSteps] = useState<PendingConfirmModalState[]>([])

  // This is a function instead of a memoized value because we do _not_ want it to update as the allowance changes.
  // For example, if the user needs to complete 3 steps initially, we should always show 3 step indicators
  // at the bottom of the modal, even after they complete steps 1 and 2.
  const generateRequiredSteps = useCallback(() => {
    const steps: PendingConfirmModalState[] = []
    steps.push(ConfirmModalState.PENDING_SEND)
    return steps
  }, [])

  const catchUserReject = async (e: any, errorType: PendingModalError) => {
    setConfirmModalState(ConfirmModalState.REVIEWING)
    if (didUserReject(e)) return
    console.error(e)
    setApprovalError(errorType)
  }

  const performStep = useCallback(
    async (step: ConfirmModalState) => {
      switch (step) {
        case ConfirmModalState.PENDING_SEND:
          setConfirmModalState(ConfirmModalState.PENDING_SEND)
          try {
            onSend()
          } catch (e) {
            catchUserReject(e, PendingModalError.CONFIRMATION_ERROR)
          }
          break
        default:
          setConfirmModalState(ConfirmModalState.REVIEWING)
          break
      }
    },
    [onSend]
  )

  const startSwapFlow = useCallback(() => {
    const steps = generateRequiredSteps()
    setPendingModalSteps(steps)
    performStep(steps[0])
  }, [generateRequiredSteps, performStep])

  const onCancel = () => {
    setConfirmModalState(ConfirmModalState.REVIEWING)
    setApprovalError(undefined)
  }

  return { startSwapFlow, onCancel, confirmModalState, approvalError, pendingModalSteps }
}

// eslint-disable-next-line import/no-unused-modules
export default function ConfirmSendModal({
  trade,
  inputAmount,
  onConfirm,
  onDismiss,
  recipient,
  sendTxHash,
  memo,
}: {
  trade: InterfaceTrade
  inputAmount: CurrencyAmount<Currency>
  onConfirm: () => void
  onDismiss: () => void
  fiatValueInput: { data?: number; isLoading: boolean }
  recipient: ResolvedRecipient
  sendTxHash?: string
  memo?: string
}) {
  const { startSwapFlow, onCancel, confirmModalState, pendingModalSteps } = useConfirmModalState({
    onSend: onConfirm,
    inputCurrency: inputAmount.currency,
  })

  const onModalDismiss = useCallback(() => {
    onDismiss()
    setTimeout(() => {
      // Reset local state after the modal dismiss animation finishes, to avoid UI flicker as it dismisses
      onCancel()
    }, MODAL_TRANSITION_DURATION)
  }, [onCancel, onDismiss])

  const modalHeader = useCallback(() => {
    if (confirmModalState !== ConfirmModalState.REVIEWING) {
      return null
    }
    return (
      // TODO: update original recipient
      <Wrapper>
        <AutoColumn justify="center" gap="24px">
          <Logo />
          <ThemedText.HeadlineMedium>{`$${formatCurrencyAmount(trade.outputAmount, 2, 'en-US', 2)} to ${
            recipient.originalRecipient
          }`}</ThemedText.HeadlineMedium>
          <ThemedText.BodyPrimary>{memo}</ThemedText.BodyPrimary>
        </AutoColumn>
      </Wrapper>
    )
  }, [confirmModalState, memo, recipient.originalRecipient, trade.outputAmount])

  const modalBottom = useCallback(() => {
    if (confirmModalState === ConfirmModalState.REVIEWING) {
      return (
        <div style={{ marginTop: '12px' }}>
          <ButtonError onClick={startSwapFlow}>
            <Text fontSize={20}>
              <Trans>Send</Trans>
            </Text>
          </ButtonError>
        </div>
      )
    }
    return (
      <PendingModalContent
        trade={trade}
        hideStepIndicators={pendingModalSteps.length === 1}
        steps={pendingModalSteps}
        currentStep={confirmModalState}
        tokenApprovalPending={false}
        revocationPending={false}
        onRetryUniswapXSignature={onConfirm}
        sendTxHash={sendTxHash}
      />
    )
  }, [confirmModalState, trade, pendingModalSteps, onConfirm, sendTxHash, startSwapFlow])

  return (
    <Modal isOpen $scrollOverlay onDismiss={onModalDismiss} maxHeight={90}>
      <ConfirmationModalContent
        title={
          confirmModalState === ConfirmModalState.REVIEWING ? (
            <ThemedText.HeadlineSmall>
              <Trans>Review send</Trans>
            </ThemedText.HeadlineSmall>
          ) : undefined
        }
        onDismiss={onModalDismiss}
        topContent={modalHeader}
        bottomContent={modalBottom}
      />
    </Modal>
  )
}
