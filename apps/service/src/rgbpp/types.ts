import { Hex } from 'rgbpp/ckb';

export interface RgbppTransferReq {
  // The transferred RGB++ xUDT type script args
  xudtTypeArgs: string;
  // The rgbpp assets cell lock script args array whose data structure is: out_index | btc_tx_id
  rgbppLockArgsList: string[];
  // The xUDT amount to be transferred
  transferAmount: Hex;
  // The sender BTC address
  fromBtcAddress: string;
  // The receiver BTC address
  toBtcAddress: string;
}

export interface RgbppTransferResp {
  // The JSON string for the `BtcTransferVirtualTxResult`
  ckbVirtualTxResult: string;
  // The BTC PSBT hex string which can be used to construct Bitcoin PSBT
  btcPsbtHex: Hex;
}
