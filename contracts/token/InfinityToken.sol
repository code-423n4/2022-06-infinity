// SPDX-License-Identifier: MIT
pragma solidity 0.8.14;

import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {ERC20Permit} from '@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol';
import {ERC20Burnable} from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol';
import {ERC20Snapshot} from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol';
import {ERC20Votes} from '@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol';

import {TimelockConfig} from './TimelockConfig.sol';

/**
 * @title InfinityTokens
 * @author nneverlander. Twitter @nneverlander
 * @notice The Infinity Token ($NFT). Implements timelock config to control token release schedule.
 */
contract InfinityToken is
  ERC20('Infinity', 'NFT'),
  ERC20Permit('Infinity'),
  ERC20Burnable,
  ERC20Snapshot,
  ERC20Votes,
  TimelockConfig
{
  bytes32 public constant EPOCH_INFLATION = keccak256('Inflation');
  bytes32 public constant EPOCH_DURATION = keccak256('EpochDuration');
  bytes32 public constant EPOCH_CLIFF = keccak256('Cliff');
  bytes32 public constant MAX_EPOCHS = keccak256('MaxEpochs');

  /* storage */
  uint256 public currentEpochTimestamp;
  uint256 public currentEpoch;
  uint256 public previousEpochTimestamp;

  event EpochAdvanced(uint256 currentEpoch, uint256 supplyMinted);

  constructor(
    address admin,
    uint256 epochInflation,
    uint256 epochDuration,
    uint256 epochCliff,
    uint256 maxEpochs,
    uint256 timelock,
    uint256 supply
  ) TimelockConfig(admin, timelock) {
    TimelockConfig._setRawConfig(EPOCH_INFLATION, epochInflation);
    TimelockConfig._setRawConfig(EPOCH_DURATION, epochDuration);
    TimelockConfig._setRawConfig(EPOCH_CLIFF, epochCliff);
    TimelockConfig._setRawConfig(MAX_EPOCHS, maxEpochs);

    previousEpochTimestamp = block.timestamp;
    currentEpochTimestamp = block.timestamp;

    // mint initial supply
    _mint(admin, supply);
  }

  // =============================================== USER FUNCTIONS =========================================================

  function advanceEpoch() external {
    require(currentEpoch < getMaxEpochs(), 'no epochs left');
    require(block.timestamp >= currentEpochTimestamp + getCliff(), 'cliff not passed');
    require(block.timestamp >= previousEpochTimestamp + getEpochDuration(), 'not ready to advance');

    uint256 epochsPassedSinceLastAdvance = (block.timestamp - previousEpochTimestamp) / getEpochDuration();
    uint256 epochsLeft = getMaxEpochs() - currentEpoch;
    epochsPassedSinceLastAdvance = epochsPassedSinceLastAdvance > epochsLeft
      ? epochsLeft
      : epochsPassedSinceLastAdvance;

    // update epochs
    currentEpoch += epochsPassedSinceLastAdvance;
    previousEpochTimestamp = block.timestamp;

    // inflation amount
    uint256 supplyToMint = getInflation() * epochsPassedSinceLastAdvance;

    // mint supply
    _mint(getAdmin(), supplyToMint);

    emit EpochAdvanced(currentEpoch, supplyToMint);
  }

  // =============================================== HOOKS =========================================================

  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 amount
  ) internal override(ERC20, ERC20Snapshot) {
    ERC20Snapshot._beforeTokenTransfer(from, to, amount);
  }

  // =============================================== REQUIRED OVERRIDES =========================================================
  function _afterTokenTransfer(
    address from,
    address to,
    uint256 amount
  ) internal override(ERC20, ERC20Votes) {
    super._afterTokenTransfer(from, to, amount);
  }

  function _mint(address to, uint256 amount) internal override(ERC20, ERC20Votes) {
    super._mint(to, amount);
  }

  function _burn(address account, uint256 amount) internal override(ERC20, ERC20Votes) {
    super._burn(account, amount);
  }

  // =============================================== VIEW FUNCTIONS =========================================================

  function getAdmin() public view returns (address admin) {
    return address(uint160(TimelockConfig.getConfig(TimelockConfig.ADMIN).value));
  }

  function getTimelock() public view returns (uint256 timelock) {
    return TimelockConfig.getConfig(TimelockConfig.TIMELOCK).value;
  }

  function getInflation() public view returns (uint256 inflation) {
    return TimelockConfig.getConfig(EPOCH_INFLATION).value;
  }

  function getCliff() public view returns (uint256 cliff) {
    return TimelockConfig.getConfig(EPOCH_CLIFF).value;
  }

  function getMaxEpochs() public view returns (uint256 totalEpochs) {
    return TimelockConfig.getConfig(MAX_EPOCHS).value;
  }

  function getEpochDuration() public view returns (uint256 epochDuration) {
    return TimelockConfig.getConfig(EPOCH_DURATION).value;
  }
}
