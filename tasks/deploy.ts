import { task } from 'hardhat/config';
import { deployContract } from './utils';
import { Contract, ethers } from 'ethers';
require('dotenv').config();

// mainnet
// const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
// polygon
// const WETH_ADDRESS = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619';
// goerli
const WETH_ADDRESS = '0xb4fbf271143f4fbf7b91a5ded31805e42b2208d6';

// other vars
let infinityToken: Contract,
infinityExchange: Contract,
  infinityOBComplication: Contract,
  infinityTreasurer: string,
  infinityStaker: Contract;

  const MINUTE = 60;
  const HOUR = MINUTE * 60;
  const DAY = HOUR * 24;
  const MONTH = DAY * 30;
  const UNIT = toBN(1e18);
  const INFLATION = toBN(250_000_000).mul(UNIT);
  const CLIFF = toBN(6);
  const CLIFF_PERIOD = CLIFF.mul(MONTH);
  const EPOCH_DURATION = CLIFF_PERIOD.toNumber();
  const MAX_EPOCHS = 3;
  const TIMELOCK = 30 * DAY;
  const INITIAL_SUPPLY = toBN(250_000_000).mul(UNIT);

  function toBN(val: any) {
    return ethers.BigNumber.from(val.toString());
  }

task('deployAll', 'Deploy all contracts')
  .addFlag('verify', 'verify contracts on etherscan')
  .setAction(async (args, { ethers, run, network }) => {
    const signer1 = (await ethers.getSigners())[0];
    const signer2 = (await ethers.getSigners())[1];

    infinityToken = await run('deployInfinityToken', {
      verify: args.verify
    });

    infinityExchange = await run('deployInfinityExchange', {
      verify: args.verify,
      wethaddress: WETH_ADDRESS,
      matchexecutor: signer2.address
    });

    infinityOBComplication = await run('deployInfinityOrderBookComplication', {
      verify: args.verify
    });

    infinityTreasurer = signer1.address;

    infinityStaker = await run('deployInfinityStaker', {
      verify: args.verify,
      token: infinityToken.address,
      treasurer: infinityTreasurer
    });

    // run post deploy actions
    await run('postDeployActions');
  });

  task('deployInfinityToken', 'Deploy Infinity token contract')
    .addFlag('verify', 'verify contracts on etherscan')
    .setAction(async (args, { ethers, run }) => {
      const signer1 = (await ethers.getSigners())[0];

      const tokenArgs = [
        signer1.address,
        INFLATION.toString(),
        EPOCH_DURATION.toString(),
        CLIFF_PERIOD.toString(),
        MAX_EPOCHS.toString(),
        TIMELOCK.toString(),
        INITIAL_SUPPLY.toString()
      ];

      const infinityToken = await deployContract(
        'InfinityToken',
        await ethers.getContractFactory('InfinityToken'),
        signer1,
        tokenArgs
      );

      // verify etherscan
      if (args.verify) {
        // console.log('Verifying source on etherscan');
        await infinityToken.deployTransaction.wait(5);
        await run('verify:verify', {
          address: infinityToken.address,
          contract: 'contracts/token/InfinityToken.sol:InfinityToken',
          constructorArguments: tokenArgs
        });
      }

      return infinityToken;
    });

task('deployInfinityExchange', 'Deploy')
  .addFlag('verify', 'verify contracts on etherscan')
  .addParam('wethaddress', 'weth address')
  .addParam('matchexecutor', 'matchexecutor address')
  .setAction(async (args, { ethers, run, network }) => {
    const signer1 = (await ethers.getSigners())[0];
    const infinityExchange = await deployContract(
      'InfinityExchange',
      await ethers.getContractFactory('InfinityExchange'),
      signer1,
      [args.wethaddress, args.matchexecutor]
    );

    // verify source
    if (args.verify) {
      // console.log('Verifying source on etherscan');
      await infinityExchange.deployTransaction.wait(5);
      await run('verify:verify', {
        address: infinityExchange.address,
        contract: 'contracts/core/InfinityExchange.sol:InfinityExchange',
        constructorArguments: [args.wethaddress, args.matchexecutor]
      });
    }
    return infinityExchange;
  });

task('deployInfinityOrderBookComplication', 'Deploy')
  .addFlag('verify', 'verify contracts on etherscan')
  .setAction(async (args, { ethers, run, network }) => {
    const signer1 = (await ethers.getSigners())[0];
    const obComplication = await deployContract(
      'InfinityOrderBookComplication',
      await ethers.getContractFactory('InfinityOrderBookComplication'),
      signer1
    );

    // verify source
    if (args.verify) {
      // console.log('Verifying source on etherscan');
      await obComplication.deployTransaction.wait(5);
      await run('verify:verify', {
        address: obComplication.address,
        contract: 'contracts/core/InfinityOrderBookComplication.sol:InfinityOrderBookComplication'
      });
    }
    return obComplication;
  });

  task('deployInfinityStaker', 'Deploy')
    .addFlag('verify', 'verify contracts on etherscan')
    .addParam('token', 'infinity token address')
    .addParam('treasurer', 'treasurer address')
    .setAction(async (args, { ethers, run, network }) => {
      const signer1 = (await ethers.getSigners())[0];
      const staker = await deployContract(
        'InfinityStaker',
        await ethers.getContractFactory('InfinityStaker'),
        signer1,
        [args.token, args.treasurer]
      );

      // verify source
      if (args.verify) {
        // console.log('Verifying source on etherscan');
        await staker.deployTransaction.wait(5);
        await run('verify:verify', {
          address: staker.address,
          contract: 'contracts/staking/InfinityStaker.sol:InfinityStaker',
          constructorArguments: [args.token, args.treasurer]
        });
      }
      return staker;
    });

task('postDeployActions', 'Post deploy').setAction(async (args, { ethers, run, network }) => {
  console.log('Post deploy actions');

  // add currencies to registry
  console.log('Adding currencies');
  await infinityExchange.addCurrency(WETH_ADDRESS);
  await infinityExchange.addCurrency('0x0000000000000000000000000000000000000000');

  // add complications to registry
  console.log('Adding complication to registry');
  await infinityExchange.addComplication(infinityOBComplication.address);
});
