import { BigNumber, Contract, ContractFactory, Signer } from 'ethers';

export async function deployContract(
  name: string,
  factory: ContractFactory,
  signer: Signer,
  args: Array<any> = []
): Promise<Contract> {
  const contract = await factory.connect(signer).deploy(...args);
  return contract.deployed();
}

export const nowSeconds = (): BigNumber => {
  return BigNumber.from(Math.floor(Date.now() / 1000));
};

export function trimLowerCase(str?: string) {
  return (str || '').trim().toLowerCase();
}

export const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
