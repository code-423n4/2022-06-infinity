const { expect } = require('chai');
const { ethers, network } = require('hardhat');
const { deployContract, nowSeconds, NULL_ADDRESS } = require('../tasks/utils');
const { prepareOBOrder, getCurrentSignedOrderPrice, approveERC20, getCurrentOrderPrice } = require('../helpers/orders');
const { erc721Abi } = require('../abi/erc721');

describe('Exchange_Match_One_To_Many', function () {
  let signers,
    signer1,
    signer2,
    signer3,
    token,
    infinityExchange,
    mock721Contract1,
    mock721Contract2,
    mock721Contract3,
    obComplication;

  const buyOrders = [];
  const sellOrders = [];

  let signer1Balance = toBN(0);
  let signer2Balance = toBN(0);
  let signer3Balance = toBN(0);
  let totalProtocolFees = toBN(0);
  let orderNonce = 0;

  const FEE_BPS = 250;
  const UNIT = toBN(1e18);
  const INITIAL_SUPPLY = toBN(1_000_000).mul(UNIT);

  const totalNFTSupply = 100;
  const numNFTsToTransfer = 50;
  const numNFTsLeft = totalNFTSupply - numNFTsToTransfer;

  function toBN(val) {
    return ethers.BigNumber.from(val.toString());
  }

  before(async () => {
    // signers
    signers = await ethers.getSigners();
    signer1 = signers[0];
    signer2 = signers[1];
    signer3 = signers[2];

    // token
    token = await deployContract('MockERC20', await ethers.getContractFactory('MockERC20'), signers[0]);

    // NFT contracts
    mock721Contract1 = await deployContract('MockERC721', await ethers.getContractFactory('MockERC721'), signer1, [
      'Mock NFT 1',
      'MCKNFT1'
    ]);
    mock721Contract2 = await deployContract('MockERC721', await ethers.getContractFactory('MockERC721'), signer1, [
      'Mock NFT 2',
      'MCKNFT2'
    ]);
    mock721Contract3 = await deployContract('MockERC721', await ethers.getContractFactory('MockERC721'), signer1, [
      'Mock NFT 3',
      'MCKNFT3'
    ]);

    // Exchange
    infinityExchange = await deployContract(
      'InfinityExchange',
      await ethers.getContractFactory('InfinityExchange'),
      signer1,
      [token.address, signer3.address]
    );

    // OB complication
    obComplication = await deployContract(
      'InfinityOrderBookComplication',
      await ethers.getContractFactory('InfinityOrderBookComplication'),
      signer1
    );

    // add currencies to registry
    await infinityExchange.addCurrency(token.address);
    await infinityExchange.addCurrency(NULL_ADDRESS);
    
    // add complications to registry
    await infinityExchange.addComplication(obComplication.address);

    // send assets
    await token.transfer(signer2.address, INITIAL_SUPPLY.div(2).toString());
    for (let i = 0; i < numNFTsToTransfer; i++) {
      await mock721Contract1.transferFrom(signer1.address, signer2.address, i);
      await mock721Contract2.transferFrom(signer1.address, signer2.address, i);
      await mock721Contract3.transferFrom(signer1.address, signer2.address, i);
    }
  });

  describe('Setup', () => {
    it('Should init properly', async function () {
      expect(await token.decimals()).to.equal(18);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);

      expect(await token.balanceOf(signer1.address)).to.equal(INITIAL_SUPPLY.div(2));
      expect(await token.balanceOf(signer2.address)).to.equal(INITIAL_SUPPLY.div(2));

      expect(await mock721Contract1.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract1.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);

      expect(await mock721Contract2.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract2.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);

      expect(await mock721Contract3.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract3.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);
    });
  });

  // ================================================== MAKE BUY ORDERS ==================================================

  // one specific collection, one specific token, max price
  describe('OneCollectionOneTokenBuy', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 0, numTokens: 1 }]
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(user, chainId, signer1, order, infinityExchange);
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // one specific collection, multiple specific tokens, max aggregate price
  describe('OneCollectionMultipleTokensBuy', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [
            { tokenId: 1, numTokens: 1 },
            { tokenId: 2, numTokens: 1 },
            { tokenId: 3, numTokens: 1 }
          ]
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther('3'),
        endPrice: ethers.utils.parseEther('3'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(user, chainId, signer1, order, infinityExchange);
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // multiple specific collections, any multiple tokens per collection, max aggregate price, min aggregate number of tokens
  describe('MultipleCollectionsAnyTokensBuy', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;

      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};

      // order1
      const nfts1 = [
        {
          collection: mock721Contract1.address,
          tokens: [
            {
              tokenId: 20,
              numTokens: 1
            },
            {
              tokenId: 21,
              numTokens: 1
            }
          ]
        }
      ];
      const nonce1 = ++orderNonce;
      const orderId1 = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [user.address, nonce1, chainId]
      );
      const order1 = {
        id: orderId1,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems: 2,
        startPrice: ethers.utils.parseEther('2'),
        endPrice: ethers.utils.parseEther('2'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),

        nonce: nonce1,
        nfts: nfts1,
        execParams,
        extraParams
      };
      const signedOrder1 = await prepareOBOrder(user, chainId, signer1, order1, infinityExchange);
      expect(signedOrder1).to.not.be.undefined;
      buyOrders.push(signedOrder1);

      // order2
      const nfts2 = [
        {
          collection: mock721Contract2.address,
          tokens: [
            {
              tokenId: 10,
              numTokens: 1
            }
          ]
        }
      ];
      const nonce2 = ++orderNonce;
      const orderId2 = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [user.address, nonce2, chainId]
      );
      const order2 = {
        id: orderId2,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems: 1,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),

        nonce: nonce2,
        nfts: nfts2,
        execParams,
        extraParams
      };
      const signedOrder2 = await prepareOBOrder(user, chainId, signer1, order2, infinityExchange);
      expect(signedOrder2).to.not.be.undefined;
      buyOrders.push(signedOrder2);

      // order3
      const nfts3 = [
        {
          collection: mock721Contract3.address,
          tokens: [
            {
              tokenId: 10,
              numTokens: 1
            },
            {
              tokenId: 11,
              numTokens: 1
            }
          ]
        }
      ];
      const nonce3 = ++orderNonce;
      const orderId3 = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [user.address, nonce3, chainId]
      );
      const order3 = {
        id: orderId3,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems: 2,
        startPrice: ethers.utils.parseEther('2'),
        endPrice: ethers.utils.parseEther('2'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),

        nonce: nonce3,
        nfts: nfts3,
        execParams,
        extraParams
      };
      const signedOrder3 = await prepareOBOrder(user, chainId, signer1, order3, infinityExchange);
      expect(signedOrder3).to.not.be.undefined;
      buyOrders.push(signedOrder3);
    });
  });

  // one specific collection, any multiple tokens, max aggregate price, min number of tokens
  describe('OneCollectionAnyMultipleTokensBuy', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: []
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: token.address };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems: 4,
        startPrice: ethers.utils.parseEther('4'),
        endPrice: ethers.utils.parseEther('4'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(user, chainId, signer1, order, infinityExchange);
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // ================================================== MAKE SELL ORDERS ==================================================

  // one specific collection, one specific token, min price
  describe('OneCollectionOneTokenSell_ETH', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 0, numTokens: 1 }]
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: NULL_ADDRESS };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };

      // approve currency (required for automatic execution)
      const salePrice = getCurrentOrderPrice(order);
      await approveERC20(user.address, execParams.currencyAddress, salePrice, signer2, infinityExchange.address);

      const signedOrder = await prepareOBOrder(user, chainId, signer2, order, infinityExchange);
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // one specific collection, multiple specific tokens, min aggregate price
  describe('OneCollectionMultipleTokensSell_ETH', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts1 = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 1, numTokens: 1 }]
        }
      ];
      const nfts2 = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 2, numTokens: 1 }]
        }
      ];
      const nfts3 = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 3, numTokens: 1 }]
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: NULL_ADDRESS };
      const extraParams = {};

      const nonce1 = ++orderNonce;
      const orderId1 = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [user.address, nonce1, chainId]
      );
      let numItems1 = 0;
      for (const nft of nfts1) {
        numItems1 += nft.tokens.length;
      }
      const order1 = {
        id: orderId1,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: numItems1,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),

        nonce: nonce1,
        nfts: nfts1,
        execParams,
        extraParams
      };
      const signedOrder1 = await prepareOBOrder(user, chainId, signer2, order1, infinityExchange);
      expect(signedOrder1).to.not.be.undefined;
      sellOrders.push(signedOrder1);

      const nonce2 = ++orderNonce;
      const orderId2 = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [user.address, nonce2, chainId]
      );
      let numItems2 = 0;
      for (const nft of nfts2) {
        numItems2 += nft.tokens.length;
      }
      const order2 = {
        id: orderId2,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: numItems2,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),

        nonce: nonce2,
        nfts: nfts2,
        execParams,
        extraParams
      };
      const signedOrder2 = await prepareOBOrder(user, chainId, signer2, order2, infinityExchange);
      expect(signedOrder2).to.not.be.undefined;
      sellOrders.push(signedOrder2);

      const nonce3 = ++orderNonce;
      const orderId3 = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [user.address, nonce3, chainId]
      );
      let numItems3 = 0;
      for (const nft of nfts3) {
        numItems3 += nft.tokens.length;
      }
      const order3 = {
        id: orderId3,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: numItems3,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),

        nonce: nonce3,
        nfts: nfts3,
        execParams,
        extraParams
      };
      const signedOrder3 = await prepareOBOrder(user, chainId, signer2, order3, infinityExchange);
      expect(signedOrder3).to.not.be.undefined;
      sellOrders.push(signedOrder3);
    });
  });

  // multiple specific collections, any multiple tokens per collection, min aggregate price, max aggregate number of tokens
  describe('MultipleCollectionsAnyTokenSell_ETH', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: []
        },
        {
          collection: mock721Contract2.address,
          tokens: []
        },
        {
          collection: mock721Contract3.address,
          tokens: []
        }
      ];
      const execParams = { complicationAddress: obComplication.address, currencyAddress: NULL_ADDRESS };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(['address', 'uint256', 'uint256'], [user.address, nonce, chainId]);
      const order = {
        id: orderId,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: 5,
        startPrice: ethers.utils.parseEther('5'),
        endPrice: ethers.utils.parseEther('5'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(user, chainId, signer2, order, infinityExchange);
      expect(signedOrder).to.not.be.undefined;
      sellOrders.push(signedOrder);
    });
  });

  // one specific collection, any multiple tokens, min aggregate price, max number of tokens
  describe('OneCollectionAnyMultipleTokensSell_ETH', () => {
    it('Signed order should be valid', async function () {
      const user = {
        address: signer2.address
      };
      const chainId = network.config.chainId ?? 31337;
      const execParams = { complicationAddress: obComplication.address, currencyAddress: NULL_ADDRESS };
      const extraParams = {};

      // order 1
      const nfts1 = [
        {
          collection: mock721Contract1.address,
          tokens: [
            {
              tokenId: 5,
              numTokens: 1
            }
          ]
        }
      ];
      const nonce1 = ++orderNonce;
      const orderId1 = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [user.address, nonce1, chainId]
      );
      const order1 = {
        id: orderId1,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: 1,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),

        nonce: nonce1,
        nfts: nfts1,
        execParams,
        extraParams
      };
      const signedOrder1 = await prepareOBOrder(user, chainId, signer2, order1, infinityExchange);
      expect(signedOrder1).to.not.be.undefined;
      sellOrders.push(signedOrder1);

      // order 2
      const nfts2 = [
        {
          collection: mock721Contract1.address,
          tokens: [
            {
              tokenId: 6,
              numTokens: 1
            },
            {
              tokenId: 7,
              numTokens: 1
            }
          ]
        }
      ];
      const nonce2 = ++orderNonce;
      const orderId2 = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [user.address, nonce2, chainId]
      );
      const order2 = {
        id: orderId2,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: 2,
        startPrice: ethers.utils.parseEther('2'),
        endPrice: ethers.utils.parseEther('2'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),

        nonce: nonce2,
        nfts: nfts2,
        execParams,
        extraParams
      };
      const signedOrder2 = await prepareOBOrder(user, chainId, signer2, order2, infinityExchange);
      expect(signedOrder2).to.not.be.undefined;
      sellOrders.push(signedOrder2);

      // order 3
      const nfts3 = [
        {
          collection: mock721Contract1.address,
          tokens: [
            {
              tokenId: 8,
              numTokens: 1
            }
          ]
        }
      ];
      const nonce3 = ++orderNonce;
      const orderId3 = ethers.utils.solidityKeccak256(
        ['address', 'uint256', 'uint256'],
        [user.address, nonce3, chainId]
      );
      const order3 = {
        id: orderId3,
        chainId,
        isSellOrder: true,
        signerAddress: user.address,
        numItems: 1,
        startPrice: ethers.utils.parseEther('1'),
        endPrice: ethers.utils.parseEther('1'),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(24 * 60 * 60),

        nonce: nonce3,
        nfts: nfts3,
        execParams,
        extraParams
      };
      const signedOrder3 = await prepareOBOrder(user, chainId, signer2, order3, infinityExchange);
      expect(signedOrder3).to.not.be.undefined;
      sellOrders.push(signedOrder3);
    });
  });

  // ============================================================ MATCHES ============================================================

  describe('Match_OneCollectionOneToken', () => {
    it('Should match valid order', async function () {
      const buyOrder = buyOrders[0];
      const sellOrder = sellOrders[0];
      const nfts = sellOrder.nfts;

      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // sale price
      const salePrice = getCurrentSignedOrderPrice(sellOrder);

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(INITIAL_SUPPLY.div(2));
      expect(await token.balanceOf(signer2.address)).to.equal(INITIAL_SUPPLY.div(2));

      // estimate gas
      const numTokens = sellOrder.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);
      console.log('total numTokens in order', numTokens);
      const gasEstimate = await infinityExchange
        .connect(signer3)
        .estimateGas.matchOneToManyOrders(buyOrder, [sellOrder]);
      console.log('gasEstimate', gasEstimate.toNumber());
      console.log('gasEstimate per token', gasEstimate / numTokens);

      // initiate exchange by 3rd party
      await infinityExchange.connect(signer3).matchOneToManyOrders(buyOrder, [sellOrder]);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const fee = salePrice.mul(FEE_BPS).div(10000);
      signer1Balance = INITIAL_SUPPLY.div(2).sub(salePrice);
      signer2Balance = INITIAL_SUPPLY.div(2).add(salePrice.sub(fee));
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      const signer1TokenBalance = await token.balanceOf(signer1.address);
      const gasRefund = signer1Balance.sub(signer1TokenBalance);
      totalProtocolFees = totalProtocolFees.add(fee).add(gasRefund);
      expect(await token.balanceOf(infinityExchange.address)).to.equal(totalProtocolFees);

      const buyerBalance1 = parseFloat(ethers.utils.formatEther(signer1TokenBalance));
      const buyerBalance2 = parseFloat(ethers.utils.formatEther(signer1Balance));
      expect(buyerBalance1).to.be.lessThan(buyerBalance2); // less than because of the gas refund

      // update to right amount
      signer1Balance = signer1TokenBalance;
    });
  });

  describe('Match_OneCollectionMultipleTokens', () => {
    it('Should match valid order', async function () {
      const buyOrder = buyOrders[1];

      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // order 1
      const sellOrder1 = sellOrders[1];
      const nfts1 = sellOrder1.nfts;
      // owners before sale
      for (const item of nfts1) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }
      const salePrice1 = getCurrentSignedOrderPrice(sellOrder1);

      // order 2
      const sellOrder2 = sellOrders[2];
      const nfts2 = sellOrder2.nfts;
      // owners before sale
      for (const item of nfts2) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }
      const salePrice2 = getCurrentSignedOrderPrice(sellOrder2);

      // order 1
      const sellOrder3 = sellOrders[3];
      const nfts3 = sellOrder3.nfts;
      // owners before sale
      for (const item of nfts3) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }
      const salePrice3 = getCurrentSignedOrderPrice(sellOrder3);

      // estimate gas
      const numTokens1 = sellOrder1.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);
      const numTokens2 = sellOrder2.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);
      const numTokens3 = sellOrder3.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);
      const numTokens = numTokens1 + numTokens2 + numTokens3;
      console.log('total numTokens in order', numTokens);
      const gasEstimate = await infinityExchange
        .connect(signer3)
        .estimateGas.matchOneToManyOrders(buyOrder, [sellOrder1, sellOrder2, sellOrder3]);
      console.log('gasEstimate', gasEstimate.toNumber());
      console.log('gasEstimate per token', gasEstimate / numTokens);

      // initiate exchange by 3rd party
      await infinityExchange.connect(signer3).matchOneToManyOrders(buyOrder, [sellOrder1, sellOrder2, sellOrder3]);

      // owners after sale
      for (const item of nfts1) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }
      for (const item of nfts2) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }
      for (const item of nfts3) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const salePrice = salePrice1.add(salePrice2).add(salePrice3);
      const fee = salePrice.mul(FEE_BPS).div(10000);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      const signer1TokenBalance = await token.balanceOf(signer1.address);
      const gasRefund = signer1Balance.sub(signer1TokenBalance);
      totalProtocolFees = totalProtocolFees.add(fee).add(gasRefund);
      expect(await token.balanceOf(infinityExchange.address)).to.equal(totalProtocolFees);

      const buyerBalance1 = parseFloat(ethers.utils.formatEther(signer1TokenBalance));
      const buyerBalance2 = parseFloat(ethers.utils.formatEther(signer2Balance));
      expect(buyerBalance1).to.be.lessThan(buyerBalance2); // less than because of the gas refund

      // update to right amount
      signer1Balance = signer1TokenBalance;
    });
  });

  describe('Match_MultipleCollectionsAnyTokensSell_ETH', () => {
    it('Should match valid order', async function () {
      const sellOrder = sellOrders[4];

      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      const buyOrder1 = buyOrders[2];
      // owners before sale
      for (const item of buyOrder1.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }
      // sale price
      const salePrice1 = getCurrentSignedOrderPrice(buyOrder1);
      // estimate gas
      const numTokens1 = buyOrder1.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);

      const buyOrder2 = buyOrders[3];
      // owners before sale
      for (const item of buyOrder2.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }
      // sale price
      const salePrice2 = getCurrentSignedOrderPrice(buyOrder2);
      // estimate gas
      const numTokens2 = buyOrder2.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);

      const buyOrder3 = buyOrders[4];
      // owners before sale
      for (const item of buyOrder3.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }
      // sale price
      const salePrice3 = getCurrentSignedOrderPrice(buyOrder3);
      // estimate gas
      const numTokens3 = buyOrder3.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);

      const numTokens = numTokens1 + numTokens2 + numTokens3;
      console.log('total numTokens in order', numTokens);
      const gasEstimate = await infinityExchange
        .connect(signer3)
        .estimateGas.matchOneToManyOrders(sellOrder, [buyOrder1, buyOrder2, buyOrder3]);
      console.log('gasEstimate', gasEstimate.toNumber());
      console.log('gasEstimate per token', gasEstimate / numTokens);

      // initiate exchange by 3rd party
      await infinityExchange.connect(signer3).matchOneToManyOrders(sellOrder, [buyOrder1, buyOrder2, buyOrder3]);

      // owners after sale
      for (const item of buyOrder1.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }
      for (const item of buyOrder2.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }
      for (const item of buyOrder3.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const salePrice = salePrice1.add(salePrice2).add(salePrice3);
      const fee = salePrice.mul(FEE_BPS).div(10000);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      const signer1TokenBalance = await token.balanceOf(signer1.address);
      const gasRefund = signer1Balance.sub(signer1TokenBalance);
      totalProtocolFees = totalProtocolFees.add(fee).add(gasRefund);
      expect(await token.balanceOf(infinityExchange.address)).to.equal(totalProtocolFees);

      const buyerBalance1 = parseFloat(ethers.utils.formatEther(signer1TokenBalance));
      const buyerBalance2 = parseFloat(ethers.utils.formatEther(signer2Balance));
      expect(buyerBalance1).to.be.lessThan(buyerBalance2); // less than because of the gas refund

      // update to right amount
      signer1Balance = signer1TokenBalance;
    });
  });

  describe('Match_OneCollectionAnyMultipleTokens_ETH', () => {
    it('Should match valid order', async function () {
      const buyOrder = buyOrders[5];
      // balance before sale
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      const sellOrder1 = sellOrders[5];
      // owners before sale
      for (const item of sellOrder1.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }
      // sale price
      const salePrice1 = getCurrentSignedOrderPrice(sellOrder1);
      // estimate gas
      const numTokens1 = sellOrder1.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);

      const sellOrder2 = sellOrders[6];
      // owners before sale
      for (const item of sellOrder2.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }
      // sale price
      const salePrice2 = getCurrentSignedOrderPrice(sellOrder2);
      // estimate gas
      const numTokens2 = sellOrder2.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);

      const sellOrder3 = sellOrders[7];
      // owners before sale
      for (const item of sellOrder3.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }
      // sale price
      const salePrice3 = getCurrentSignedOrderPrice(sellOrder3);
      // estimate gas
      const numTokens3 = sellOrder3.nfts.reduce((acc, nft) => {
        return (
          acc +
          nft.tokens.reduce((acc, token) => {
            return acc + token.numTokens;
          }, 0)
        );
      }, 0);

      const numTokens = numTokens1 + numTokens2 + numTokens3;
      console.log('total numTokens in order', numTokens);
      const gasEstimate = await infinityExchange
        .connect(signer3)
        .estimateGas.matchOneToManyOrders(buyOrder, [sellOrder1, sellOrder2, sellOrder3]);
      console.log('gasEstimate', gasEstimate.toNumber());
      console.log('gasEstimate per token', gasEstimate / numTokens);

      // initiate exchange by 3rd party
      await infinityExchange.connect(signer3).matchOneToManyOrders(buyOrder, [sellOrder1, sellOrder2, sellOrder3]);

      // owners after sale
      for (const item of sellOrder1.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }
      for (const item of sellOrder2.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }
      for (const item of sellOrder3.nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const salePrice = salePrice1.add(salePrice2).add(salePrice3);
      const fee = salePrice.mul(FEE_BPS).div(10000);
      signer1Balance = signer1Balance.sub(salePrice);
      signer2Balance = signer2Balance.add(salePrice.sub(fee));
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      const signer1TokenBalance = await token.balanceOf(signer1.address);
      const gasRefund = signer1Balance.sub(signer1TokenBalance);
      totalProtocolFees = totalProtocolFees.add(fee).add(gasRefund);
      expect(await token.balanceOf(infinityExchange.address)).to.equal(totalProtocolFees);

      const buyerBalance1 = parseFloat(ethers.utils.formatEther(signer1TokenBalance));
      const buyerBalance2 = parseFloat(ethers.utils.formatEther(signer2Balance));
      expect(buyerBalance1).to.be.lessThan(buyerBalance2); // less than because of the gas refund

      // update to right amount
      signer1Balance = signer1TokenBalance;
    });
  });
});
