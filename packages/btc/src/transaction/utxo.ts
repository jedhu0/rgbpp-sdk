import cloneDeep from 'lodash/cloneDeep.js';
import { ErrorCodes, TxBuildError } from '../error';
import { DataSource } from '../query/source';
import { AddressType, AddressToPubkeyMap } from '../address';
import { TxInput } from './build';
import { limitPromiseBatchSize, remove0x, toXOnly } from '../utils';
import { isP2trScript } from '../script';
import { bitcoin } from '../bitcoin';

export interface BaseOutput {
  txid: string;
  vout: number;
}

export interface Output extends BaseOutput {
  value: number;
  scriptPk: string;
}

export interface Utxo extends Output {
  addressType: AddressType;
  address: string;
  pubkey?: string;
}

export function utxoToInput(utxo: Utxo): TxInput {
  if (utxo.addressType === AddressType.P2WPKH) {
    const data = {
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        value: utxo.value,
        script: Buffer.from(remove0x(utxo.scriptPk), 'hex'),
      },
    };

    return {
      data,
      utxo,
    };
  }
  if (utxo.addressType === AddressType.P2TR) {
    if (!utxo.pubkey) {
      throw TxBuildError.withComment(ErrorCodes.MISSING_PUBKEY, utxo.address);
    }
    const data = {
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        value: utxo.value,
        script: Buffer.from(remove0x(utxo.scriptPk), 'hex'),
      },
      tapInternalKey: toXOnly(Buffer.from(remove0x(utxo.pubkey), 'hex')),
    };
    return {
      data,
      utxo,
    };
  }

  if (utxo.addressType === AddressType.P2SH) {
    const data = {
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        value: utxo.value,
        script: Buffer.from(utxo.scriptPk, 'hex'),
      },
    };
    return {
      data,
      utxo,
    };
  }

  if (utxo.addressType === AddressType.P2SH_P2WPKH) {
    if (!utxo.pubkey) {
      throw TxBuildError.withComment(ErrorCodes.MISSING_PUBKEY, utxo.address);
    }
    const redeemData = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(utxo.pubkey, 'hex'),
    });
    const data = {
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        value: utxo.value,
        script: Buffer.from(utxo.scriptPk, 'hex'),
      },
      redeemScript: redeemData.output,
    };
    return {
      data,
      utxo,
    };
  }

  throw new TxBuildError(ErrorCodes.UNSUPPORTED_ADDRESS_TYPE);
}

/**
 * Fill pubkey for P2TR UTXO, and optionally throw an error if pubkey is missing
 */
export function fillUtxoPubkey(
  utxo: Utxo,
  pubkeyMap: AddressToPubkeyMap,
  options?: {
    requirePubkey?: boolean;
  },
): Utxo {
  const newUtxo = cloneDeep(utxo);
  if (isP2trScript(newUtxo.scriptPk) && !newUtxo.pubkey) {
    const pubkey = pubkeyMap[newUtxo.address];
    if (options?.requirePubkey && !pubkey) {
      throw TxBuildError.withComment(ErrorCodes.MISSING_PUBKEY, newUtxo.address);
    }
    if (pubkey) {
      newUtxo.pubkey = pubkey;
    }
  }

  return newUtxo;
}

/**
 * Prepare and validate UTXOs for transaction building:
 * 1. Fill pubkey for P2TR UTXOs, and optionally throw an error if pubkey is missing
 * 2. Optionally check if the UTXOs are confirmed, and throw an error if not
 */
export async function prepareUtxoInputs(props: {
  utxos: Utxo[];
  source: DataSource;
  requirePubkey?: boolean;
  requireConfirmed?: boolean;
  pubkeyMap?: AddressToPubkeyMap;
}): Promise<Utxo[]> {
  const pubkeyMap = props.pubkeyMap ?? {};
  const utxos = props.utxos.map((utxo) => {
    return fillUtxoPubkey(utxo, pubkeyMap, {
      requirePubkey: props.requirePubkey,
    });
  });

  if (props.requireConfirmed) {
    await Promise.all(
      utxos.map(async (utxo) => {
        return limitPromiseBatchSize(async () => {
          const transactionConfirmed = await props.source.isTransactionConfirmed(utxo.txid);
          if (!transactionConfirmed) {
            throw TxBuildError.withComment(ErrorCodes.UNCONFIRMED_UTXO, `hash: ${utxo.txid}, index: ${utxo.vout}`);
          }
        });
      }),
    );
  }

  return utxos;
}
