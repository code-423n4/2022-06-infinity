// SPDX-License-Identifier: MIT
pragma solidity 0.8.14;

import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {IERC20, SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {Pausable} from '@openzeppelin/contracts/security/Pausable.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import {IStaker, Duration, StakeLevel} from '../interfaces/IStaker.sol';

/**
 * @title InfinityStaker
 * @author nneverlander. Twitter @nneverlander
 * @notice The staker contract that allows people to stake tokens and earn voting power to be used in curation and possibly other places
 */
contract InfinityStaker is IStaker, Ownable, Pausable, ReentrancyGuard {
  using SafeERC20 for IERC20;
  struct StakeAmount {
    uint256 amount;
    uint256 timestamp;
  }

  ///@dev Storage variable to keep track of the staker's staked duration and amounts
  mapping(address => mapping(Duration => StakeAmount)) public userstakedAmounts;

  address public INFINITY_TOKEN;
  ///@dev Infinity treasury address - will be a EOA/multisig
  address public INFINITY_TREASURY;

  /**@dev Power levels to reach the specified stake thresholds. Users can reach these levels 
          either by staking the specified number of tokens for no duration or a less number of tokens but with higher durations.
          See getUserStakePower() to see how users can reach these levels.
  */
  uint16 public BRONZE_STAKE_THRESHOLD = 1000;
  uint16 public SILVER_STAKE_THRESHOLD = 5000;
  uint16 public GOLD_STAKE_THRESHOLD = 10000;
  uint16 public PLATINUM_STAKE_THRESHOLD = 20000;

  ///@dev Penalties if staked tokens are rageQuit early. Example: If 100 tokens are staked for twelve months but rageQuit right away,
  /// the user will get back 100/4 tokens.
  uint16 public THREE_MONTH_PENALTY = 2;
  uint16 public SIX_MONTH_PENALTY = 3;
  uint16 public TWELVE_MONTH_PENALTY = 4;

  event Staked(address indexed user, uint256 amount, Duration duration);
  event DurationChanged(address indexed user, uint256 amount, Duration oldDuration, Duration newDuration);
  event UnStaked(address indexed user, uint256 amount);
  event RageQuit(address indexed user, uint256 totalToUser, uint256 penalty);

  constructor(address _tokenAddress, address _infinityTreasury) {
    INFINITY_TOKEN = _tokenAddress;
    INFINITY_TREASURY = _infinityTreasury;
  }

  // Fallback
  fallback() external payable {}

  receive() external payable {}

  // =================================================== USER FUNCTIONS =======================================================

  /**
   * @notice Stake tokens for a specified duration
   * @dev Tokens are transferred from the user to this contract
   * @param amount Amount of tokens to stake
   * @param duration Duration of the stake
   */
  function stake(uint256 amount, Duration duration) external override nonReentrant whenNotPaused {
    require(amount != 0, 'stake amount cant be 0');
    require(IERC20(INFINITY_TOKEN).balanceOf(msg.sender) >= amount, 'insufficient balance to stake');
    // update storage
    userstakedAmounts[msg.sender][duration].amount += amount;
    userstakedAmounts[msg.sender][duration].timestamp = block.timestamp;
    // perform transfer
    IERC20(INFINITY_TOKEN).safeTransferFrom(msg.sender, address(this), amount);
    // emit event
    emit Staked(msg.sender, amount, duration);
  }

  /**
   * @notice Change duration of staked tokens
   * @dev Duration can be changed from low to high but not from high to low. State updates are performed
   * @param amount Amount of tokens to change duration
   * @param oldDuration Old duration of the stake
   * @param newDuration New duration of the stake
   */
  function changeDuration(
    uint256 amount,
    Duration oldDuration,
    Duration newDuration
  ) external override nonReentrant whenNotPaused {
    require(amount != 0, 'amount cant be 0');
    require(
      userstakedAmounts[msg.sender][oldDuration].amount >= amount,
      'insufficient staked amount to change duration'
    );
    require(newDuration > oldDuration, 'new duration must be greater than old duration');

    // update storage
    userstakedAmounts[msg.sender][oldDuration].amount -= amount;
    userstakedAmounts[msg.sender][newDuration].amount += amount;
    // update timestamp for new duration
    userstakedAmounts[msg.sender][newDuration].timestamp = block.timestamp;
    // only update old duration timestamp if old duration amount is 0
    if (userstakedAmounts[msg.sender][oldDuration].amount == 0) {
      userstakedAmounts[msg.sender][oldDuration].timestamp = 0;
    }
    // emit event
    emit DurationChanged(msg.sender, amount, oldDuration, newDuration);
  }

  /**
   * @notice Untake tokens
   * @dev Storage updates are done for each stake level. See _updateUserStakedAmounts for more details
   * @param amount Amount of tokens to unstake
   */
  function unstake(uint256 amount) external override nonReentrant whenNotPaused {
    require(amount != 0, 'stake amount cant be 0');
    uint256 noVesting = userstakedAmounts[msg.sender][Duration.NONE].amount;
    uint256 vestedThreeMonths = getVestedAmount(msg.sender, Duration.THREE_MONTHS);
    uint256 vestedsixMonths = getVestedAmount(msg.sender, Duration.SIX_MONTHS);
    uint256 vestedTwelveMonths = getVestedAmount(msg.sender, Duration.TWELVE_MONTHS);
    uint256 totalVested = noVesting + vestedThreeMonths + vestedsixMonths + vestedTwelveMonths;
    require(totalVested >= amount, 'insufficient balance to unstake');

    // update storage
    _updateUserStakedAmounts(msg.sender, amount, noVesting, vestedThreeMonths, vestedsixMonths, vestedTwelveMonths);
    // perform transfer
    IERC20(INFINITY_TOKEN).safeTransfer(msg.sender, amount);
    // emit event
    emit UnStaked(msg.sender, amount);
  }

  /**
   * @notice Ragequit tokens. Applies penalties for unvested tokens
   */
  function rageQuit() external override nonReentrant {
    (uint256 totalToUser, uint256 penalty) = getRageQuitAmounts(msg.sender);
    // update storage
    _clearUserStakedAmounts(msg.sender);
    // perform transfers
    IERC20(INFINITY_TOKEN).safeTransfer(msg.sender, totalToUser);
    IERC20(INFINITY_TOKEN).safeTransfer(INFINITY_TREASURY, penalty);
    // emit event
    emit RageQuit(msg.sender, totalToUser, penalty);
  }

  // ====================================================== VIEW FUNCTIONS ======================================================

  /**
   * @notice Get total staked tokens for a user for all durations
   * @param user address of the user
   * @return total amount of tokens staked by the user
   */
  function getUserTotalStaked(address user) public view override returns (uint256) {
    return
      userstakedAmounts[user][Duration.NONE].amount +
      userstakedAmounts[user][Duration.THREE_MONTHS].amount +
      userstakedAmounts[user][Duration.SIX_MONTHS].amount +
      userstakedAmounts[user][Duration.TWELVE_MONTHS].amount;
  }

  /**
   * @notice Get total vested tokens for a user for all durations
   * @param user address of the user
   * @return total amount of vested tokens for the user
   */
  function getUserTotalVested(address user) public view override returns (uint256) {
    uint256 noVesting = getVestedAmount(user, Duration.NONE);
    uint256 vestedThreeMonths = getVestedAmount(user, Duration.THREE_MONTHS);
    uint256 vestedsixMonths = getVestedAmount(user, Duration.SIX_MONTHS);
    uint256 vestedTwelveMonths = getVestedAmount(user, Duration.TWELVE_MONTHS);
    return noVesting + vestedThreeMonths + vestedsixMonths + vestedTwelveMonths;
  }

  /**
   * @notice Gets rageQuit amounts for a user after applying penalties
   * @dev Penalty amounts are sent to Infinity treasury
   * @param user address of the user
   * @return Total amount to user and penalties
   */
  function getRageQuitAmounts(address user) public view override returns (uint256, uint256) {
    uint256 noLock = userstakedAmounts[user][Duration.NONE].amount;
    uint256 threeMonthLock = userstakedAmounts[user][Duration.THREE_MONTHS].amount;
    uint256 sixMonthLock = userstakedAmounts[user][Duration.SIX_MONTHS].amount;
    uint256 twelveMonthLock = userstakedAmounts[user][Duration.TWELVE_MONTHS].amount;

    uint256 threeMonthVested = getVestedAmount(user, Duration.THREE_MONTHS);
    uint256 sixMonthVested = getVestedAmount(user, Duration.SIX_MONTHS);
    uint256 twelveMonthVested = getVestedAmount(user, Duration.TWELVE_MONTHS);

    uint256 totalVested = noLock + threeMonthVested + sixMonthVested + twelveMonthVested;
    uint256 totalStaked = noLock + threeMonthLock + sixMonthLock + twelveMonthLock;
    require(totalStaked >= 0, 'nothing staked to rage quit');

    uint256 totalToUser = totalVested +
      ((threeMonthLock - threeMonthVested) / THREE_MONTH_PENALTY) +
      ((sixMonthLock - sixMonthVested) / SIX_MONTH_PENALTY) +
      ((twelveMonthLock - twelveMonthVested) / TWELVE_MONTH_PENALTY);

    uint256 penalty = totalStaked - totalToUser;

    return (totalToUser, penalty);
  }

  /**
   * @notice Gets a user's stake level
   * @param user address of the user
   * @return StakeLevel
   */
  function getUserStakeLevel(address user) external view override returns (StakeLevel) {
    uint256 totalPower = getUserStakePower(user);

    if (totalPower <= BRONZE_STAKE_THRESHOLD) {
      return StakeLevel.NONE;
    } else if (totalPower > BRONZE_STAKE_THRESHOLD && totalPower <= SILVER_STAKE_THRESHOLD) {
      return StakeLevel.BRONZE;
    } else if (totalPower > SILVER_STAKE_THRESHOLD && totalPower <= GOLD_STAKE_THRESHOLD) {
      return StakeLevel.SILVER;
    } else if (totalPower > GOLD_STAKE_THRESHOLD && totalPower <= PLATINUM_STAKE_THRESHOLD) {
      return StakeLevel.GOLD;
    } else {
      return StakeLevel.PLATINUM;
    }
  }

  /**
   * @notice Gets a user stake power. Used to determine voting power in curating collections and possibly other places
   * @dev Tokens staked for higher duration apply a multiplier
   * @param user address of the user
   * @return user stake power
   */
  function getUserStakePower(address user) public view override returns (uint256) {
    return
      ((userstakedAmounts[user][Duration.NONE].amount * 1) +
        (userstakedAmounts[user][Duration.THREE_MONTHS].amount * 2) +
        (userstakedAmounts[user][Duration.SIX_MONTHS].amount * 3) +
        (userstakedAmounts[user][Duration.TWELVE_MONTHS].amount * 4)) / (10**18);
  }

  /**
   * @notice Returns staking info for a user's staked amounts for different durations
   * @param user address of the user
   * @return Staking amounts for different durations
   */
  function getStakingInfo(address user) external view returns (StakeAmount[] memory) {
    StakeAmount[] memory stakingInfo = new StakeAmount[](4);
    stakingInfo[0] = userstakedAmounts[user][Duration.NONE];
    stakingInfo[1] = userstakedAmounts[user][Duration.THREE_MONTHS];
    stakingInfo[2] = userstakedAmounts[user][Duration.SIX_MONTHS];
    stakingInfo[3] = userstakedAmounts[user][Duration.TWELVE_MONTHS];
    return stakingInfo;
  }

  /**
   * @notice Returns vested amount for a user for a given duration
   * @param user address of the user
   * @param duration the duration
   * @return Vested amount for the given duration
   */
  function getVestedAmount(address user, Duration duration) public view returns (uint256) {
    uint256 amount = userstakedAmounts[user][duration].amount;
    uint256 timestamp = userstakedAmounts[user][duration].timestamp;
    // short circuit if no vesting for this duration
    if (timestamp == 0) {
      return 0;
    }
    uint256 durationInSeconds = _getDurationInSeconds(duration);
    uint256 secondsSinceStake = block.timestamp - timestamp;

    return secondsSinceStake >= durationInSeconds ? amount : 0;
  }

  // ====================================================== INTERNAL FUNCTIONS ================================================

  function _getDurationInSeconds(Duration duration) internal pure returns (uint256) {
    if (duration == Duration.THREE_MONTHS) {
      return 90 days;
    } else if (duration == Duration.SIX_MONTHS) {
      return 180 days;
    } else if (duration == Duration.TWELVE_MONTHS) {
      return 360 days;
    } else {
      return 0 seconds;
    }
  }

  /** @notice Update user staked amounts for different duration on unstake
    * @dev A more elegant recursive function is possible but this is more gas efficient
   */
  function _updateUserStakedAmounts(
    address user,
    uint256 amount,
    uint256 noVesting,
    uint256 vestedThreeMonths,
    uint256 vestedSixMonths,
    uint256 vestedTwelveMonths
  ) internal {
    if (amount > noVesting) {
      userstakedAmounts[user][Duration.NONE].amount = 0;
      userstakedAmounts[user][Duration.NONE].timestamp = 0;
      amount = amount - noVesting;
      if (amount > vestedThreeMonths) {
        userstakedAmounts[user][Duration.THREE_MONTHS].amount = 0;
        userstakedAmounts[user][Duration.THREE_MONTHS].timestamp = 0;
        amount = amount - vestedThreeMonths;
        if (amount > vestedSixMonths) {
          userstakedAmounts[user][Duration.SIX_MONTHS].amount = 0;
          userstakedAmounts[user][Duration.SIX_MONTHS].timestamp = 0;
          amount = amount - vestedSixMonths;
          if (amount > vestedTwelveMonths) {
            userstakedAmounts[user][Duration.TWELVE_MONTHS].amount = 0;
            userstakedAmounts[user][Duration.TWELVE_MONTHS].timestamp = 0;
          } else {
            userstakedAmounts[user][Duration.TWELVE_MONTHS].amount -= amount;
          }
        } else {
          userstakedAmounts[user][Duration.SIX_MONTHS].amount -= amount;
        }
      } else {
        userstakedAmounts[user][Duration.THREE_MONTHS].amount -= amount;
      }
    } else {
      userstakedAmounts[user][Duration.NONE].amount -= amount;
    }
  }

  /// @dev clears staking info for a user on rageQuit
  function _clearUserStakedAmounts(address user) internal {
    // clear amounts
    userstakedAmounts[user][Duration.NONE].amount = 0;
    userstakedAmounts[user][Duration.THREE_MONTHS].amount = 0;
    userstakedAmounts[user][Duration.SIX_MONTHS].amount = 0;
    userstakedAmounts[user][Duration.TWELVE_MONTHS].amount = 0;

    // clear timestamps
    userstakedAmounts[user][Duration.NONE].timestamp = 0;
    userstakedAmounts[user][Duration.THREE_MONTHS].timestamp = 0;
    userstakedAmounts[user][Duration.SIX_MONTHS].timestamp = 0;
    userstakedAmounts[user][Duration.TWELVE_MONTHS].timestamp = 0;
  }

  // ====================================================== ADMIN FUNCTIONS ================================================

  /// @dev Admin function to rescue any ETH accidentally sent to the contract
  function rescueETH(address destination) external payable onlyOwner {
    (bool sent, ) = destination.call{value: msg.value}('');
    require(sent, 'Failed to send Ether');
  }

  /// @dev Admin function to update stake level thresholds
  function updateStakeLevelThreshold(StakeLevel stakeLevel, uint16 threshold) external onlyOwner {
    if (stakeLevel == StakeLevel.BRONZE) {
      BRONZE_STAKE_THRESHOLD = threshold;
    } else if (stakeLevel == StakeLevel.SILVER) {
      SILVER_STAKE_THRESHOLD = threshold;
    } else if (stakeLevel == StakeLevel.GOLD) {
      GOLD_STAKE_THRESHOLD = threshold;
    } else if (stakeLevel == StakeLevel.PLATINUM) {
      PLATINUM_STAKE_THRESHOLD = threshold;
    }
  }

  /// @dev Admin function to update rageQuit penalties
  function updatePenalties(
    uint16 threeMonthPenalty,
    uint16 sixMonthPenalty,
    uint16 twelveMonthPenalty
  ) external onlyOwner {
    THREE_MONTH_PENALTY = threeMonthPenalty;
    SIX_MONTH_PENALTY = sixMonthPenalty;
    TWELVE_MONTH_PENALTY = twelveMonthPenalty;
  }

  /// @dev Admin function to update Infinity treasury
  function updateInfinityTreasury(address _infinityTreasury) external onlyOwner {
    INFINITY_TREASURY = _infinityTreasury;
  }
}
