import { buildRgbppLockArgs } from 'rgbpp/ckb';
import { genLeapSporeFromBtcToCkbVirtualTx, sendRgbppUtxos } from 'rgbpp';
import { getSporeTypeScript, Hex } from 'rgbpp/ckb';
import { serializeScript } from '@nervosnetwork/ckb-sdk-utils';
import { isMainnet, collector, btcDataSource, btcService, btcAccount, BTC_TESTNET_TYPE } from '../env';
import { getFastestFeeRate, readStepLog } from '../shared/utils';
import { saveCkbVirtualTxResult } from '../../../examples/rgbpp/shared/utils';
import { signAndSendPsbt } from '../../../examples/rgbpp/shared/btc-account';

interface SporeLeapParams {
  sporeRgbppLockArgs: Hex;
  toCkbAddress: string;
  sporeTypeArgs: Hex;
}

const leapSporeFromBtcToCkb = async ({ sporeRgbppLockArgs, toCkbAddress, sporeTypeArgs }: SporeLeapParams) => {
  const { retry } = await import('zx');

  const feeRate = await getFastestFeeRate();
  console.log('feeRate = ', feeRate);

  await retry(20, '10s', async () => {
    const sporeTypeBytes = serializeScript({
      ...getSporeTypeScript(isMainnet),
      args: sporeTypeArgs,
    });

    const ckbVirtualTxResult = await genLeapSporeFromBtcToCkbVirtualTx({
      collector,
      sporeRgbppLockArgs,
      sporeTypeBytes,
      toCkbAddress,
      isMainnet,
      btcTestnetType: BTC_TESTNET_TYPE,
    });

    // Save ckbVirtualTxResult
    saveCkbVirtualTxResult(ckbVirtualTxResult, '5-leap-spore-to-ckb');

    const { commitment, ckbRawTx, needPaymasterCell } = ckbVirtualTxResult;

    // Send BTC tx
    const psbt = await sendRgbppUtxos({
      ckbVirtualTx: ckbRawTx,
      commitment,
      tos: [btcAccount.from],
      needPaymaster: needPaymasterCell,
      ckbCollector: collector,
      from: btcAccount.from,
      fromPubkey: btcAccount.fromPubkey,
      source: btcDataSource,
      feeRate: feeRate,
    });

    const { txId: btcTxId } = await signAndSendPsbt(psbt, btcAccount, btcService);
    console.log('BTC TxId: ', btcTxId);
    console.log(`explorer: https://mempool.space/signet/tx/${btcTxId}`);

    await btcService.sendRgbppCkbTransaction({ btc_txid: btcTxId, ckb_virtual_result: ckbVirtualTxResult });

    try {
      const interval = setInterval(async () => {
        const { state, failedReason } = await btcService.getRgbppTransactionState(btcTxId);
        console.log('state', state);
        if (state === 'completed' || state === 'failed') {
          clearInterval(interval);
          if (state === 'completed') {
            const { txhash: txHash } = await btcService.getRgbppTransactionHash(btcTxId);
            console.info(`Rgbpp spore has been leaped from BTC to CKB and the related CKB tx hash is ${txHash}`);
            console.info(`explorer: https://pudge.explorer.nervos.org/transaction/${txHash}`);
          } else {
            console.warn(`Rgbpp CKB transaction failed and the reason is ${failedReason} `);
          }
        }
      }, 30 * 1000);
    } catch (error) {
      console.error(error);
    }
  });
};

// Please use your real BTC UTXO information on the BTC Testnet
// rgbppLockArgs: outIndexU32 + btcTxId
leapSporeFromBtcToCkb({
  sporeRgbppLockArgs: buildRgbppLockArgs(3, readStepLog('create-spores-id').txid),
  toCkbAddress: 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq0e4xk4rmg5jdkn8aams492a7jlg73ue0gc0ddfj',
  // Please use your own RGB++ spore asset's sporeTypeArgs
  sporeTypeArgs: readStepLog('sporeTypeScripts')[1].args,
});
