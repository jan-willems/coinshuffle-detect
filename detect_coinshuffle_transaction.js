#!/usr/bin/env node

/**
 * Bitcoin CoinShuffle pattern matcher
 *
 * Dependencies: underscore, q, insight-api
 *
 * Insight Express API controller locations:
 * ./app/controllers/blocks
 * ./app/controllers/transactions
 *
 * Maximum amount of transactions parseable in one go depends on
 * the memory capacity of the machine. 425,224 transactions with
 * 12GiB of memory resulted in a 'process out of memory'.
 *
 * @author Jan-Willem Selij <jan-willem.selij at os3.nl>
 */

"use strict";

var _ = require('underscore');
var Q = require('q');
//var RateLimiter = require('limiter').RateLimiter;

/* Insight Lower-level API's */
var bdb = require('./lib/BlockDb').default();
var tDb = require('./lib/TransactionDb').default();

//var limiter = new RateLimiter(1000, (65 * 1000));
//var limiter = new RateLimiter(5000, (10 * 1000));

// global, meh. count of transactions checked
// couldn't get this right with all the function closures 3 deep
var transactionsDone = 0;

/* Only used for .then() chain */
//var timespan = {start: "1404957600", end: "1404961200"};

// date: Date() object
var createDateString = function(date, includeTimestamp) {
	includeTimestamp = includeTimestamp || false;
	var dateString = date.getFullYear() + "-" + prependZero(date.getMonth() + 1) + "-" + prependZero(date.getDate());
	var dateStringTime = prependZero(date.getHours()) + ":" + prependZero(date.getMinutes()) + ":" + prependZero(date.getSeconds());
	var dateNow = dateString + " " + dateStringTime;
	if (includeTimestamp) {
		dateNow = dateNow + " (TS: " + Math.floor(date.getTime() / 1000) + ")";
	}
	return dateNow;
}

// prepend a zero if < 10
var prependZero = function(time) {
	if (time < 10) {
		return "0" + time;
	}
	return time;
}

/* Non-think mode way */
var showProgress = function(i, total) {
	var dateNow = createDateString(new Date(), true);

	if (i == 1) { console.log("0% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == Math.round(total * 0.10)) { console.log("10% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == Math.round(total * 0.20)) { console.log("20% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == Math.round(total * 0.30)) { console.log("30% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == Math.round(total * 0.40)) { console.log("40% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == Math.round(total * 0.50)) { console.log("50% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == Math.round(total * 0.60)) { console.log("60% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == Math.round(total * 0.70)) { console.log("70% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == Math.round(total * 0.80)) { console.log("80% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == Math.round(total * 0.90)) { console.log("90% [" + i + "/" + total + "] @ " + dateNow); }
	if (i == total) { console.log("100% [" + i + "/" + total + "] @ " + dateNow); }
}

// start/end: unix timestamp
// gets all blocks from a certain timespan
var getBlocksByTimespan = function(timespan) {
	var start = timespan.start;
	var end = timespan.end;
	console.log(start);
	console.log(end);
	var startDate = createDateString(new Date(start * 1000));
	var endDate = createDateString(new Date(end * 1000));

	var deferred = Q.defer();
	var limit = 1000000; // block fetch limit

	console.log("-> Block chain start date " + startDate);
	console.log("<- Block chain end date " + endDate);

	bdb.getBlocksByDate(start, end, limit, function(err, blocks) {
		if (err) {
			console.log("bdb.getBlocksByDate Error -> " + err);
		}

		deferred.resolve(_.pluck(blocks, "hash"));
	});
	return deferred.promise;
}

// blockHashes = [hash1, hash2, ...]
var getTransactionsByBlockHashes = function(blockHashes) {
	var promises = [];
	var transactions = [];

	console.log("Block hashes: " + _.size(blockHashes));

	// https://coderwall.com/p/ijy61g/promise-chains-with-node-js
	blockHashes.forEach(function(blockHash) {
		var deferred = Q.defer();
		bdb.fromHashWithInfo(blockHash, function(err, block) {
			if (err) {
				console.log("bdb.fromHashWithInfo Error -> " + err);
			}

			//transactions = transactions.concat(block.info.tx);
			deferred.resolve(block.info.tx);
		});
		promises.push(deferred.promise);

	});
	
	/* There's probably a way to do this right in the forEach() above */
	return Q.all(promises).then(function(output) {
		output.forEach(function(trans) {
			transactions = transactions.concat(trans);
		});
		return transactions;
	});
}

// [hash1, hash2, ...]
var checkTransactionsForShuffle = function(transactionHashes) {
	var promises = [];
	var totalTransactionHashes = _.size(transactionHashes);

	console.log("Transaction hashes: " + _.size(transactionHashes));

	transactionHashes.forEach(function(txid) {
		var deferred = Q.defer();

		// creates an RPC connection for each call, 3k txids means 3k connections, which
		// is too much. throttle?
		//limiter.removeTokens(1, function() {
			tDb.fromIdWithInfo(txid, function(err, tx) {
				if (err || ! tx) {
					console.log("tDb.fromIdWithInfo Error -> " + err);
					console.log("tDb.fromIdWithInfo Error -> TX id " + txid + " not checked.");
				}
				else {
					checkShuffle(tx.info)
					transactionsDone = transactionsDone + 1;
					showProgress(transactionsDone, totalTransactionHashes);
				}
				/* Just resolve, even if we encounter an error */
				deferred.resolve(true);
			});
		promises.push(deferred.promise);
		//});
	});

	return Q.all(promises).then(function(output) {
		transactionsDone = 0;
		return output;
	});
}


var testf = function(output) {
	console.log("!!!!" + JSON.stringify(output));
}

console.log("Checking block chain for CoinShuffle transactions.");

/* Sync async promise, probably not the right way to do it */
var createTimespanPromise = function(start, end) {
	return function() {
		var deferred = Q.defer();
		deferred.resolve({start: start, end: end});
		return deferred.promise;
	}
}

// start: ts
// seconds: incremental seconds
// times: time to repeat
// {start: "1404957600", end: "1404961200"};
var createTimespan = function(start, seconds, times) {
	var timespans = [];
	var newEnd = start;
	console.log("--> createTimespan start: " + createDateString(new Date(start * 1000)));
	console.log("<-- createTimespan end: " + createDateString(new Date((start * 1000) + (seconds * times) * 1000)));

	for (var i = 1; i <= times; i++) {
		newEnd = start + seconds;
		timespans = timespans.concat([createTimespanPromise(start, newEnd)]);
		start = newEnd;
		timespans = timespans.concat([getBlocksByTimespan, getTransactionsByBlockHashes, checkTransactionsForShuffle]);
	}

	return timespans;
}



/**
 * Check if a certain transaction amount has N occurrences
 *
 * @param transactionAmounts: {amount: <occurrences>, amount2: <occurences>, ...}
 * @param occurrences: occurrences
 */
var transactionHasIdenticalAmount = function(transactionAmounts, occurrences) {
	for (var amount in transactionAmounts) {
		if (transactionAmounts[amount] === occurrences) {
			return {amount: amount, occurrences: occurrences};
		}
	}
	return false;
}


/* Check if this transaction is a shuffle */
var checkShuffle = function(transaction) {
	var txId = transaction.txid;

	var inTransactions = transaction.vin;
	var outTransactions = transaction.vout;
	var totalIn = inTransactions.length;
	var totalOut = outTransactions.length;

	var transactionAmounts = {};

	/* Require at least 5 inputs or "participants" */
	if (totalIn < 5) {
		return false;
	}
	
	/* Check if output addresses is two times incoming */
	if (totalOut != (2 * totalIn)) {
		return false;
	}
	
	// Counts all identical amounts in Satoshis
	// {"0":1,"10000000":1,"23000000":1,"30000000":1,"40000000":1,"45000000":1,"50000000":1,"59990000":1,"70000000":1,"100000000":10,"110000000":1}
	// this can also be done by creating a list with objects for each value, but this might create some overhead
	// because the values have to be extracted again
	// this could be refactored into a separate function
	for (var i = 0; i < outTransactions.length; i++) {
		var transactionAmount = outTransactions[i];

		/* https://en.bitcoin.it/wiki/Proper_Money_Handling_(JSON-RPC)#ECMAScript */
		transactionAmount = (Math.round(1e8 * transactionAmount.value));

		if (!transactionAmounts.hasOwnProperty(transactionAmount)) {
			transactionAmounts[transactionAmount] = 1;
		}
		else {
			transactionAmounts[transactionAmount] = transactionAmounts[transactionAmount] + 1;
		}
		transactionAmount = 0;
	}
	
	/* Check for occurrences with the same amount as output (same as in) */
	var sameAmount = transactionHasIdenticalAmount(transactionAmounts, totalIn);

	/* Occurrences matches input addresses */	
	if (sameAmount) {
		var txString = "[TX id: " + txId + "] ";
		var BTCAmount = sameAmount.amount / 100000000.0;

		/*
		 * Check if every input address actually can spend the "shuffle" amount
		 * This check will be useless if the protocol allows for more than one input address.
		 */
		var notAbleToSpend = 0;
		for (var i = 0; i < totalIn; i++) {
			//console.log(inTransactions[i].valueSat);
			if (inTransactions[i].valueSat < sameAmount.amount) {
				notAbleToSpend++;
			}
		}

		console.log(txString + "Possible CoinShuffle transaction [" + createDateString(new Date(transaction.blocktime * 1000), true) + "]");
		console.log(txString + "Ins: " + totalIn + " Outs: " + totalOut);
		console.log(txString + sameAmount.occurrences + " occurrences of " + sameAmount.amount + " satoshi (" + BTCAmount + " BTC)");

		if (notAbleToSpend > 0) {
			console.log(txString + "Warning: not every participant is able to spend " + BTCAmount + "BTC! (" + notAbleToSpend + " too low)");
		}

		/* One-line summary for easier grepping */
		var overview = "";
		overview = overview + "summary: [" + createDateString(new Date(transaction.blocktime * 1000)) + "]";
		overview = overview + txString + "[i: " + totalIn + " o: " + totalOut + "] ";
		overview = overview + "[s: " + sameAmount.amount + " btc: " + BTCAmount + "] [valid: " + (notAbleToSpend > 0 ? "0" : "1") + "]";
		console.log(overview);
		
		
		// can also req the block hash again if required
		//BlockDb.prototype.getBlockForTx = function(txId, cb) {

		return true;
	}

	return false;
}


/**
 * This is used to create a certain time span that should be checked.
 * Modify to set the time span.
 *
 * Example: (1414807200, 86400, 30), which starts November 2014,
 * increments in 86400 seconds (1 day), 30 times (because there are
 * 30 days in November), so this takes the whole month.
 * It then checks for shuffles day for day.
 */
var timespansToCheck = createTimespan(1396317600, 86400, 61);

/* Q's way of sequencing an array of promises */

var result = Q();
timespansToCheck.forEach(function (f) {
	result = result.then(f);
});

/* Earlier promise chain method, single time span */
/*
getBlocksByTimespan(timespan)
	.then(getTransactionsByBlockHashes)
	.then(checkTransactionsForShuffle);
*/


/* Manually check some transactions, requires a list of transaction hashes */
var txid = "b00b14e614134a901db3fb4f6fda2ef25869a3a3628329432affb9207f38a923"
//checkTransactionsForShuffle([txid]);
