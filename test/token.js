const { expect } = require('chai');
const { ethers, network } = require('hardhat');

describe('Infinity_Token', function () {
  let signers, token;
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

  let epochsSinceLastAdvance = 0;

  function toBN(val) {
    return ethers.BigNumber.from(val.toString());
  }

  before(async () => {
    signers = await ethers.getSigners();
    const InfinityToken = await ethers.getContractFactory('InfinityToken');
    token = await InfinityToken.deploy(
      signers[0].address,
      INFLATION.toString(),
      EPOCH_DURATION.toString(),
      CLIFF_PERIOD.toString(),
      MAX_EPOCHS.toString(),
      TIMELOCK.toString(),
      INITIAL_SUPPLY.toString()
    );
    await token.deployed();
  });

  describe('Setup', () => {
    it('Should init properly', async function () {
      expect(await token.name()).to.equal('Infinity');
      expect(await token.symbol()).to.equal('NFT');
      expect(await token.decimals()).to.equal(18);
      expect(await token.getAdmin()).to.equal(signers[0].address);
      expect(await token.getTimelock()).to.equal(TIMELOCK);
      expect(await token.getInflation()).to.equal(INFLATION);
      expect(await token.getCliff()).to.equal(CLIFF_PERIOD);
      expect(await token.getMaxEpochs()).to.equal(MAX_EPOCHS);
      expect(await token.getEpochDuration()).to.equal(EPOCH_DURATION);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);
      expect(await token.balanceOf(signers[0].address)).to.equal(INITIAL_SUPPLY);
    });
  });

  describe('Pre-cliff', () => {
    it('Should not allow advancing directly after deployment', async function () {
      await expect(token.advanceEpoch()).to.be.revertedWith('cliff not passed');
    });
    it('Should not allow advancing even if very close to the cliff', async function () {
      await network.provider.send('evm_increaseTime', [CLIFF_PERIOD.sub(5 * MINUTE).toNumber()]);
      await expect(token.advanceEpoch()).to.be.revertedWith('cliff not passed');
    });
  });

  describe('Post-cliff', () => {
    it('Should allow advancing after cliff is passed', async function () {
      await network.provider.send('evm_increaseTime', [5 * MINUTE]);
      await token.advanceEpoch();
      epochsSinceLastAdvance++;
      expect((await token.balanceOf(signers[0].address)).toString()).to.equal(
        INITIAL_SUPPLY.add(INFLATION.mul(epochsSinceLastAdvance)).toString()
      );
    });
    it('Should not allow advancing again before epoch period has passed', async function () {
      await network.provider.send('evm_increaseTime', [EPOCH_DURATION - 5 * MINUTE]);
      await expect(token.advanceEpoch()).to.be.revertedWith('not ready to advance');
    });
    it('Should allow advancing after epoch period has passed', async function () {
      await network.provider.send('evm_increaseTime', [5 * MINUTE]);
      await token.advanceEpoch();
      epochsSinceLastAdvance++;
      expect((await token.balanceOf(signers[0].address)).toString()).to.equal(
        INITIAL_SUPPLY.add(INFLATION.mul(epochsSinceLastAdvance)).toString()
      );
    });
    it('Should not allow advancing again before epoch period has passed', async function () {
      await network.provider.send('evm_increaseTime', [EPOCH_DURATION - 5 * MINUTE]);
      await expect(token.advanceEpoch()).to.be.revertedWith('not ready to advance');
    });
    it('Should vest full amount if an epoch is missed', async function () {
      await network.provider.send('evm_increaseTime', [EPOCH_DURATION * 2]);
      await token.advanceEpoch();
      epochsSinceLastAdvance++;
      expect((await token.balanceOf(signers[0].address)).toString()).to.equal(
        INITIAL_SUPPLY.add(INFLATION.mul(epochsSinceLastAdvance)).toString()
      );
    });
    it('Should vest the full amount after all epochs have passed', async function () {
      for (let i = await token.currentEpoch(); i < MAX_EPOCHS; i++) {
        await network.provider.send('evm_increaseTime', [EPOCH_DURATION]);
        await token.advanceEpoch();
        expect((await token.balanceOf(signers[0].address)).toString()).to.equal(
          INITIAL_SUPPLY.add(toBN(i).add(toBN(1)).mul(INFLATION)).toString()
        );
      }
      expect((await token.balanceOf(signers[0].address)).toString()).to.equal(
        INITIAL_SUPPLY.add(toBN(MAX_EPOCHS).mul(INFLATION)).toString()
      );
      // console.log('final balance:', (await token.balanceOf(signers[0].address)).toString());
    });
    it('Should not allow advancing past epoch limit', async function () {
      await network.provider.send('evm_increaseTime', [EPOCH_DURATION]);
      await expect(token.advanceEpoch()).to.be.revertedWith('no epochs left');
    });
  });
  describe('Update values', () => {
    it('Should not allow a non-owner to make a proposal', async function () {
      let maxEpochsConfig = await token.MAX_EPOCHS();
      await expect(token.connect(signers[1]).requestChange(maxEpochsConfig, MAX_EPOCHS + 1)).to.be.revertedWith(
        'only admin'
      );
    });
    it('Should allow owner to make a proposal', async function () {
      let maxEpochsConfig = await token.MAX_EPOCHS();
      await token.requestChange(maxEpochsConfig, MAX_EPOCHS + 1);
      expect((await token.getMaxEpochs()).toNumber()).to.equal(MAX_EPOCHS); // should keep old epoch for now
    });
    it('Should not allow confirmation before period has passed', async function () {
      await network.provider.send('evm_increaseTime', [TIMELOCK - 5 * MINUTE]);
      let maxEpochsConfig = await token.MAX_EPOCHS();
      await expect(token.confirmChange(maxEpochsConfig)).to.be.revertedWith('too early');
    });
    it('Should not enact a proposed change in the contract', async function () {
      await expect(token.advanceEpoch()).to.be.revertedWith('no epochs left');
    });
    it('Should allow confirmation after period has passed', async function () {
      await network.provider.send('evm_increaseTime', [5 * MINUTE]);
      let maxEpochsConfig = await token.MAX_EPOCHS();
      await token.confirmChange(maxEpochsConfig);
      expect((await token.getMaxEpochs()).toNumber()).to.equal(MAX_EPOCHS + 1);
    });
    it('Should enact the confirmed change in the contract and should only pay out the one period even if multiple epochs have been missed', async function () {
      await network.provider.send('evm_increaseTime', [12 * EPOCH_DURATION]);
      await token.advanceEpoch();
      expect((await token.balanceOf(signers[0].address)).toString()).to.equal(
        INITIAL_SUPPLY.add(toBN(MAX_EPOCHS + 1).mul(INFLATION)).toString()
      );
    });
    it('Should allow owner to cancel a proposal', async function () {
      let maxEpochsConfig = await token.MAX_EPOCHS();
      await token.requestChange(maxEpochsConfig, MAX_EPOCHS + 1);
      expect(await token.isPending(maxEpochsConfig));
      expect((await token.getPendingCount()).toString()).to.equal('1');
      await token.cancelChange(maxEpochsConfig);
      expect(!(await token.isPending(maxEpochsConfig)));
      expect((await token.getPendingCount()).toString()).to.equal('0');
    });
    it('Should allow the owner to be changed', async function () {
      let adminConfig = await token.ADMIN();
      await token.requestChange(adminConfig, signers[1].address);
      expect(await token.getAdmin()).to.equal(signers[0].address);
      await network.provider.send('evm_increaseTime', [TIMELOCK]);
      await token.confirmChange(adminConfig);
      expect(await token.getAdmin()).to.equal(signers[1].address);
    });
  });
});
