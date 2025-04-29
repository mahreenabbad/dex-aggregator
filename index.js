
import fetch from 'node-fetch';
global.fetch = fetch;  // needed if you use node-fetch in Node <18
import 'dotenv/config'
import { BitflowSDK } from '@bitflowlabs/core-sdk';
import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  contractPrincipalCV,
  uintCV,
  someCV,
  boolCV,
  tupleCV,
  // No more old "makeStandard..." functions
} from '@stacks/transactions';
import { STACKS_MAINNET } from '@stacks/network';
// ----------------------------------------------------------------
// 1) Configure Bitflow & Stacks network
// ----------------------------------------------------------------
const bitflow = new BitflowSDK({
  BITFLOW_API_HOST: process.env.BITFLOW_API_HOST,
  BITFLOW_API_KEY: process.env.BITFLOW_API_KEY,
  READONLY_CALL_API_HOST: process.env.READONLY_CALL_API_HOST,
  KEEPER_API_KEY: process.env.KEEPER_API_KEY,
  KEEPER_API_HOST: process.env.KEEPER_API_HOST
});
// For Mainnet, you can do:
const network = STACKS_MAINNET;
function convertBitflowArgToCV(arg) {
  switch (arg.type) {
    case 'contract': {
      const [addr, contractName] = arg.value.split('.');
      return contractPrincipalCV(addr, contractName);
    }
    case 'uint': {
      // Bitflow usually returns a BigInt or numeric string in arg.value
      return uintCV(arg.value);
    }
    case 'some': {
      // "some" => an optional clarity value
      const nestedCV = convertBitflowArgToCV(arg.value);
      return someCV(nestedCV);
    }
    case 'true':{
      return boolCV(true)
    }
    case 'false':{
      return boolCV(false)
    }
    case 'tuple':{
      return tupleCV(arg.value)
    }
    
    default:
      throw new Error(`Unsupported arg.type: ${arg.type}`);
  }
}
function convertBitflowPCtoHR(pc) {
  if (pc.type === 'ft-postcondition') {
    // => a FungiblePostCondition
    return {
      type: 'ft-postcondition',
      address: pc.address,
      condition: pc.condition,    // 'eq' | 'gte' | 'lte'
      amount: pc.amount.toString(),
      asset: pc.asset,           // 'SPxxxx.contract::tokenName'
    };
  }
  if (pc.type === 'stx-postcondition') {
    // => an StxPostCondition
    return {
      type: 'stx-postcondition',
      address: pc.address,
      condition: pc.condition,    // 'eq' | 'gte' | 'lte'
      amount: pc.amount.toString()
    };
  }
  // For NFTs (rare in a swap scenario), you'd do 'nft-postcondition'
  throw new Error(`Unsupported postcondition type: ${pc.type}`);
}
// ----------------------------------------------------------------
// 4) Main function to do a swap on server side
// ----------------------------------------------------------------
async function serverSideSwap() {
  try {
    // 4.1) Get quote from Bitflow
    const tokenXId = 'token-aeusdc';
    const tokenY = await bitflow.getAllPossibleTokenY(tokenXId);
    const tokenYId = tokenY[11];
    const swapAmount = 0.01;

    
    // Use the bestRoute provided by the Bitflow SDK
    const quoteResult = await bitflow.getQuoteForRoute(tokenXId, tokenYId, swapAmount);
    
      console.log('quoteResult:', quoteResult.bestRoute.quote);
    
    // 4.2) Select your route
    const selectedRoute = quoteResult.bestRoute;
    if (!selectedRoute) {
      throw new Error('No route found in quoteResult');
    }
    // console.log('Best route from Bitflow SDK:', selectedRoute);
    // 4.3) Build swapExecutionData
    const swapExecutionData = {
      route: selectedRoute.route,
      amount: swapAmount,
      tokenXDecimals: selectedRoute.tokenXDecimals,
      tokenYDecimals: selectedRoute.tokenYDecimals,
    };
    // 4.4) Retrieve swapParams from Bitflow
    const senderAddress = 'SPXWGJQ101N1C1FYHK64TGTHN4793CHVKTJAT7VQ'; // or whichever
    const slippageTolerance = 0.01; // 1%
    const swapParams = await bitflow.getSwapParams(
      swapExecutionData,
      senderAddress,
      slippageTolerance
    );
    console.log('swapParams:', swapParams);
    // 4.5) Convert function args + build "human-readable" postConditions
    const functionArgs = swapParams.functionArgs.map(convertBitflowArgToCV);
    const postConditions = swapParams.postConditions.map(convertBitflowPCtoHR);
    // 4.6) Build transaction
    // Provide your private key in WIF or hex
    const privateKey = 'stacks private key';
    const txOptions = {
      contractAddress: swapParams.contractAddress,     // e.g. "SPxxxx"
      contractName: swapParams.contractName,           // e.g. "wrapper-alex-v-2-1"
      functionName: swapParams.functionName,           // e.g. "swap-helper-a"
      functionArgs,
      senderKey: privateKey,
      network,
      anchorMode: AnchorMode.Any,
      // Use postConditionMode + postConditions
      postConditionMode: PostConditionMode.Deny,
      postConditions,
    };
    // Make the contract call
    const transaction = await makeContractCall(txOptions);
    // 4.7) Broadcast
    const broadcastResult = await broadcastTransaction({ transaction, network: STACKS_MAINNET });
    console.log('Broadcast result:', broadcastResult);
    // Optionally wait for confirmation by polling the transaction ID
    return broadcastResult;
  } catch (error) {
    console.error('Swap failed:', error);
    throw error;
  }
}
// ----------------------------------------------------------------
// 5) Run the function
// ----------------------------------------------------------------
serverSideSwap().then(() => {
  console.log('Swap finished (or failed).');
});


///////////////////////////////
// Step 1: Retrieve all possible routes
//  const allRoutes = await bitflow.getAllPossibleTokenYRoutes(tokenXId, tokenYId);
//  console.log('All routes:', allRoutes);

// Check if routes are available
//  if (!allRoutes || allRoutes.length === 0) {
  //    throw new Error('No routes found between the specified tokens.');
  //  }
  
  // Step 2: Select a route (Option 1 or Option 2)
  //  let selectedRoute;
  
  //  // Option 1: Manually select a route by specifying an array index
  //  const manualRouteIndex = 0; // Change this index to select a different route
  //  if (manualRouteIndex >= 0 && manualRouteIndex < allRoutes.length) {
    //    selectedRoute = allRoutes[manualRouteIndex];
    //    console.log('Manually selected route:', selectedRoute);
    //  } else {
      //    throw new Error('Invalid route index specified.');
      //  }
      /////////////////////////////////
      // const functionArgs = swapParams.functionArgs.map((arg, index) => {
      //   try {
      //     return convertBitflowArgToCV(arg);
      //   } catch (error) {
      //     console.error(`Error converting argument at index ${index}:`, arg);
      //     throw new Error(`Failed to convert argument at index ${index}: ${error.message}`);
      //   }
      // });
