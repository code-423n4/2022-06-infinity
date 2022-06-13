// SPDX-License-Identifier: MIT
pragma solidity 0.8.14;

import {EnumerableSet} from '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';

contract TimelockConfig {
  using EnumerableSet for EnumerableSet.Bytes32Set;

  bytes32 public constant ADMIN = keccak256('Admin');
  bytes32 public constant TIMELOCK = keccak256('Timelock');

  struct Config {
    bytes32 id;
    uint256 value;
  }

  struct PendingChange {
    bytes32 id;
    uint256 value;
    uint256 timestamp;
  }

  struct PendingChangeData {
    uint256 value;
    uint256 timestamp;
  }

  mapping(bytes32 => uint256) _config;
  EnumerableSet.Bytes32Set _configSet;

  mapping(bytes32 => PendingChangeData) _pending;
  EnumerableSet.Bytes32Set _pendingSet;

  event ChangeRequested(bytes32 configId, uint256 value);
  event ChangeConfirmed(bytes32 configId, uint256 value);
  event ChangeCanceled(bytes32 configId, uint256 value);

  modifier onlyAdmin() {
    require(msg.sender == address(uint160(_config[ADMIN])), 'only admin');
    _;
  }

  constructor(address admin, uint256 timelock) {
    _setRawConfig(ADMIN, uint256(uint160((admin))));
    _setRawConfig(TIMELOCK, timelock);
  }

  // =============================================== USER FUNCTIONS =========================================================

  function confirmChange(bytes32 configId) external {
    require(isPending(configId), 'No pending configId found');
    require(block.timestamp >= _pending[configId].timestamp + _config[TIMELOCK], 'too early');

    uint256 value = _pending[configId].value;
    _configSet.add(configId);
    _config[configId] = value;

    _pendingSet.remove(configId);
    delete _pending[configId];

    emit ChangeConfirmed(configId, value);
  }

  // =============================================== INTERNAL FUNCTIONS =========================================================

  function _setRawConfig(bytes32 configId, uint256 value) internal {
    _configSet.add(configId);
    _config[configId] = value;

    emit ChangeRequested(configId, value);
    emit ChangeConfirmed(configId, value);
  }

  // =============================================== VIEW FUNCTIONS =========================================================

  function calculateConfigId(string memory name) external pure returns (bytes32 configId) {
    return keccak256(abi.encodePacked(name));
  }

  function isConfig(bytes32 configId) external view returns (bool status) {
    return _configSet.contains(configId);
  }

  function getConfigCount() external view returns (uint256 count) {
    return _configSet.length();
  }

  function getConfigByIndex(uint256 index) external view returns (Config memory config) {
    bytes32 configId = _configSet.at(index);
    return Config(configId, _config[configId]);
  }

  function getConfig(bytes32 configId) public view returns (Config memory config) {
    require(_configSet.contains(configId), 'not config');
    return Config(configId, _config[configId]);
  }

  function isPending(bytes32 configId) public view returns (bool status) {
    return _pendingSet.contains(configId);
  }

  function getPendingCount() external view returns (uint256 count) {
    return _pendingSet.length();
  }

  function getPendingByIndex(uint256 index) external view returns (PendingChange memory pendingRequest) {
    bytes32 configId = _pendingSet.at(index);
    return PendingChange(configId, _pending[configId].value, _pending[configId].timestamp);
  }

  function getPending(bytes32 configId) external view returns (PendingChange memory pendingRequest) {
    require(_pendingSet.contains(configId), 'not pending');
    return PendingChange(configId, _pending[configId].value, _pending[configId].timestamp);
  }

  // =============================================== ADMIN FUNCTIONS =========================================================

  function requestChange(bytes32 configId, uint256 value) external onlyAdmin {
    require(_pendingSet.add(configId), 'request already exists');

    _pending[configId] = PendingChangeData(value, block.timestamp);

    emit ChangeRequested(configId, value);
  }

  function cancelChange(bytes32 configId) external onlyAdmin {
    require(_pendingSet.remove(configId), 'no pending request');

    uint256 value = _pending[configId].value;

    delete _pending[configId];

    emit ChangeCanceled(configId, value);
  }
}
