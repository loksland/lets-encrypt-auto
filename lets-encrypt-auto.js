#! /usr/bin/env node

var fs = require('fs');
var path = require('path');
const Nightmare = require('nightmare')
const nightmare = Nightmare({ show: true, typeInterval: 1 })
var cmd = require('node-cmd');
var yaml = require('js-yaml');
var prompt = require('prompt');
const CONFIG_FILE_PATH = 'config.yml'
var colors = require("colors/safe");
var del = require('delete');

function LetsEncryptAuto(jobDirPath){

	var config = yaml.safeLoad(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
	config.workingDir = path.join(config.workingDir);
	if (!fs.existsSync(config.workingDir) || !fs.statSync(config.workingDir).isDirectory()){
		fs.mkdirSync(config.workingDir);
	} else if (!config.isRenewal){
		// delete previous keys
		del.sync(config.workingDir + '/*');
	}

	step1(config);

}

function step1(config){

	nightmare
	.goto('https://gethttpsforfree.com/')
	.insert('#email', config.email)

	var cmds = [];

	cmds.push(`cd "`+config.workingDir+`"`);

	// 1. Generate an account private key if you don't have one:
	if (!config.isRenewal){
		cmds.push(`openssl genrsa 4096 > account.key`);
	}
	// 2. Print your public key
	cmds.push(`openssl rsa -in account.key -pubout`);

	cmd.get(
		cmds.join('\n')
		,
		function(err, data, stderr){
				if (!err) {

					nightmare
					.insert('#pubkey', data)
					.wait(1000)
					.click('#validate_account_submit')
					.evaluate((selector, done) => {
						window.scrollTo(0,document.body.scrollHeight);
						function waitForStatus(){
							if (document.getElementById(selector).style.display != 'none'){
								if (document.getElementById(selector).innerText.toLowerCase().split('proceed to').length > 1){
									done(null, true);
									return;
								} else if (document.getElementById(selector).innerText.toLowerCase().split('error').length > 1){
									done(null, false);
									return;
								}
							}
							setTimeout(waitForStatus, 100);
							return;
						}
						waitForStatus();
					}, 'validate_account_status')
					.then(success => {
						if (success){
							step2(config);
						} else {
							close(config);
						}
					});

				} else {
					 console.log('error', err)
					 close(config);
				}

		}
	);

}

function step2(config){

	var cmds = [];

	cmds.push(`cd "`+config.workingDir+`";`);

	// 1. Generate a TLS private key if you don't have one:
	if (!config.isRenewal){
		cmds.push(`openssl genrsa 4096 > domain.key;`);
	}

	// 2. Generate a CSR for your the domains you want certs for:
	// Need to wrap cmd in
	// ```
	// bash -c '%cmd%'
	// ```
	// as it contains process substitution Eg. <(process sub)
	cmds.push(`bash -c \'openssl req -new -sha256 -key domain.key -subj "/" -reqexts SAN -config <(cat `+config.openSSLConfigPath+` <(printf "\\n[SAN]\\nsubjectAltName=DNS:`+config.domain+`,DNS:www.`+config.domain+`"))\'`);

	cmd.get(
		cmds.join('\n')
		,
		function(err, data, stderr){
				if (!err) {
					nightmare
					.insert('#csr', data)
					.wait(1000)
					.click('#validate_csr_submit')
					.evaluate((selector, done) => {
						window.scrollTo(0,document.body.scrollHeight);
						function waitForStatus(){
							if (document.getElementById(selector).style.display != 'none'){
								if (document.getElementById(selector).innerText.toLowerCase().split('proceed to').length > 1){
									done(null, true);
									return;
								} else if (document.getElementById(selector).innerText.toLowerCase().split('error').length > 1){
									done(null, false);
									return;
								}
							}
							setTimeout(waitForStatus, 50);
							return;
						}
						waitForStatus();
					}, 'validate_csr_status')
					.then(success => {
						if (success){
							step3A(config, -1);
						} else {
							close(config);
						}
					});

				} else {
					 console.log('error', err)
					 close(config);
				}
		}
	);
}


function step3A(config, partIndex){

	partIndex++;

	var cmdFieldID;
	if (partIndex == 0){
		cmdFieldID = 'registration_sig_cmd';
	} else if (partIndex == 1){
		cmdFieldID = 'update_sig_cmd';
	} else if  (partIndex == 2){
		cmdFieldID = 'order_sig_cmd';
	} else {
		step4A(config, -1);
		return;
	}

	// 3:1 Accept the Let's Encrypt terms and conditions
	// 3:2 Update your account email
	// 3:3 Create your certificate order
	nightmare
	.wait(1000)
	.evaluate((selector, done) => {
		window.scrollTo(0,document.body.scrollHeight);
		var selField = document.getElementById(selector);
		done(null, (selField && !selField.disabled) ? selField.value : false);
	}, cmdFieldID)
	.then(fieldVal => {
		if (fieldVal !== false){

			var cmds = [];
			cmds.push(`cd "`+config.workingDir+`";`);
			cmds.push(`bash -c \'`+fieldVal+`\'`);
			cmd.get(
				cmds.join('\n')
				,
				function(err, data, stderr){
					if (!err) {
						step3B(config, partIndex, data)
					} else {
						close(config);
					}
				}
			);


		} else {
			close(config);
		}
	});

}


function step3B(config, partIndex, data){

	var inputFieldID;
	var btnID;
	var statusID;
	if (partIndex == 0){
		inputFieldID = 'registration_sig';
		btnID = 'validate_registration_sig';
		statusID = 'validate_registration_sig_status';
	} else if (partIndex == 1){
		inputFieldID = 'update_sig';
		btnID = 'validate_update_sig';
		statusID = 'validate_update_sig_status';
	} else if  (partIndex == 2){
		inputFieldID = 'order_sig';
		btnID = 'validate_order_sig';
		statusID = 'validate_order_sig_status';
	}

	nightmare
	.insert('#'+inputFieldID, data.trim())
	.wait(1000)
	.click('#'+btnID)
	.wait(1000)
	.evaluate((selector, done) => {
		window.scrollTo(0,document.body.scrollHeight);
		function waitForStatus(){
			if (document.getElementById(selector).style.display != 'none'){
				if (document.getElementById(selector).innerText.toLowerCase().split('proceed to').length > 1){
					done(null, true);
					return;
				} else if (document.getElementById(selector).innerText.toLowerCase().split('error').length > 1){
					done(null, false);
					return;
				}
			}
			setTimeout(waitForStatus, 50);
			return;
		}
		waitForStatus();
	}, statusID)
	.then(success => {
		if (success){
			step3A(config, partIndex);
		} else {
			close(config);
		}
	});

}

// Verify ownership
function step4A(config, domainIndex){

	domainIndex++;
	if (domainIndex == 2){
		step5A(config);
		return;
	}

	nightmare
	.wait(1000)
	.click('#challenge_domains > div:nth-of-type('+String(1+domainIndex)+') .tabs label:nth-of-type(2)') // Note: nth-of is 1-indexed
	.evaluate((selectors, done) => { // Get the domain ID

		var result = {};
		var success = true;
		for (var sel in selectors) {
			if (document.querySelectorAll(selectors[sel]).length == 1){
				result[sel] = document.querySelector(selectors[sel]).value;
			} else {
				success = false;
				break;
			}
		}
		if (success){
			done(null, result);
		} else {
			done(null, false)
		}

	}, {url:'#challenge_domains > div:nth-of-type('+String(1+domainIndex)+') input.file_url',
	content:'#challenge_domains > div:nth-of-type('+String(1+domainIndex)+') input.file_data'
	})
	.then(challengeInfo => {
		if (challengeInfo !== false){
			step4B(config, domainIndex, challengeInfo);
		} else {
			close(config);
		}
	});

}

// Ensure SFTP password has been entered
function step4B(config, domainIndex, challengeInfo){

	if (typeof config.sftpPassword === 'undefined'){

		prompt.message = '';
 		prompt.delimiter = ' ';
		prompt.start();
  	prompt.get({
			name: 'sftpPassword',
    	description: colors.green('Enter SFTP password:'),
    	type: 'string',
    	hidden: true,
    	replace: '*',
    	required: true
  	},
		function (err, result) {
			config.sftpPassword = result.sftpPassword; // Save to config obj
			step4C(config, domainIndex, challengeInfo);
  	});
	} else {
		step4C(config, domainIndex, challengeInfo);
	}

}

// Upload validation file to server
function step4C(config, domainIndex, challengeInfo){

	var challengeFileName = path.basename(challengeInfo.url);
	var localTmpDirName = '.tmp'
	var localTmpDirPath = path.join(config.workingDir, localTmpDirName);
	if (!fs.existsSync(localTmpDirPath) || !fs.statSync(localTmpDirPath).isDirectory()){
		fs.mkdirSync(localTmpDirPath);
	}
	var localChallengeFilePath = path.join(localTmpDirPath, challengeFileName);
	fs.writeFileSync(localChallengeFilePath, challengeInfo.content, 'utf8');

	var remoteChallengeTopLevelDirPath = path.join(config.stpPathToRoot, '.well-known');
	var remoteChallengeDirPath = path.join(remoteChallengeTopLevelDirPath, 'acme-challenge');
	var remoteChallengeFilePath = path.join(remoteChallengeDirPath, challengeFileName);

	let Client = require('ssh2-sftp-client');
	let sftp = new Client();
	sftp.connect({
	    host: config.sftpHost,
	    port: typeof config.sftpPort !== 'undefined' ? config.sftpPort : '22',
	    username: config.sftpUsername,
	    password: config.sftpPassword
	}).then(() => {
			return sftp.mkdir(remoteChallengeDirPath, true); // Recursive
	}).then(() => {
		return sftp.put(localChallengeFilePath, remoteChallengeFilePath, true, 'utf8', {
			step: function ( totalTx, chunk, total ) {
					console.log( 'uploading... totalTx', totalTx, 'chunk', chunk, 'total', total);
			}
		});
	}).then((data) => {
			del.sync(localTmpDirPath); // Clean up
			sftp.end();
	    step4D(config, domainIndex);
	}).catch((err) => {
	    console.log(err, 'catch error');
			sftp.end();
			close(config);
	});

}

function step4D(config, domainIndex){

	nightmare
	.wait(1000)
	.click('#challenge_domains > div:nth-of-type('+String(1+domainIndex)+') input.confirm_file_submit') // Note: nth-of is 1-indexed
	.wait(1000)
	.evaluate((selector, done) => { // Get the domain ID

		var checkForFieldVal = function(){

			if (document.querySelectorAll(selector).length == 1){
				var result = document.querySelector(selector).value;
				if (result.split('PRIV_KEY=').length > 1) {
					done(null, result);
				} else {
					setTimeout(checkForFieldVal, 500);
				}
			} else {
				done(null, false);
			}

		}

		checkForFieldVal()

	}, '#challenge_domains > div:nth-of-type('+String(1+domainIndex)+') input.file_sig_cmd')
	.then(fieldVal => {
		if (fieldVal !== false){

			var cmds = [];
			cmds.push(`cd "`+config.workingDir+`";`);
			cmds.push(`bash -c \'`+fieldVal+`\'`);
			cmd.get(
				cmds.join('\n')
				,
				function(err, data, stderr){
					if (!err) {
						step4E(config, domainIndex, data)
					} else {
						close(config);
					}
				}
			);

		} else {
			close(config);
		}
	});

}

function step4E(config, domainIndex, data){

	nightmare
	.insert('#challenge_domains > div:nth-of-type('+String(1+domainIndex)+') input.file_sig', data.trim())
	.wait(1000)
	.click('#challenge_domains > div:nth-of-type('+String(1+domainIndex)+') input.validate_file_sig_submit')
	.wait(1000)
	.evaluate((selector, done) => {

		function waitForStatus(){

			if (document.querySelectorAll(selector).length == 1){

				var val = document.querySelector(selector).innerText.toLowerCase();
				if (val.split('go to next').length > 1){
					done(null, true);
					return;
				} else if (val.split('error').length > 1){
					done(null, false);
					return;
				} else {
					setTimeout(waitForStatus, 100);
				}
			} else {
				done(null, false);
			}

		}
		waitForStatus();
	}, '#challenge_domains > div:nth-of-type('+String(1+domainIndex)+') span.file_sig_status')
	.then(success => {
		if (success){
			step4F(config, domainIndex);
		} else {
			close(config);
		}
	});


}

function step4F(config, domainIndex){

	// Remove challenge files from remote
	var remoteChallengeTopLevelDirPath = path.join(config.stpPathToRoot, '.well-known');

	let Client = require('ssh2-sftp-client');
	let sftp = new Client();
	sftp.connect({
	    host: config.sftpHost,
	    port: typeof config.sftpPort !== 'undefined' ? config.sftpPort : '22',
	    username: config.sftpUsername,
	    password: config.sftpPassword
	}).then(() => {
			return sftp.rmdir(remoteChallengeTopLevelDirPath, true); // Recursive
	}).then((data) => {
			sftp.end();
			step4A(config, domainIndex);
	}).catch((err) => {
	    console.log(err, 'catch error');
			sftp.end();
			close(config);
	});

}

// Generate certificate
function step5A(config){

	nightmare
	.wait(1000)
	.evaluate((selector, done) => {

		window.scrollTo(0,document.body.scrollHeight);

		var selField = document.getElementById(selector);
		done(null, (selField && !selField.disabled) ? selField.value : false);

		var checkForFieldVal = function(){
			if (document.getElementById(selector)){
				var result = document.getElementById(selector).value;
				if (result.split('PRIV_KEY=').length > 1) {
					done(null, result);
				} else {
					setTimeout(checkForFieldVal, 500);
				}
			} else {
				done(null, false);
			}
		}

		checkForFieldVal();

	}, 'finalize_sig_cmd')
	.then(fieldVal => {
		if (fieldVal !== false){

			var cmds = [];
			cmds.push(`cd "`+config.workingDir+`";`);
			cmds.push(`bash -c \'`+fieldVal+`\'`);
			cmd.get(
				cmds.join('\n')
				,
				function(err, data, stderr){

					if (!err) {
						step5B(config, data)
					} else {
						close(config);
					}
				}
			);

		} else {
			close(config);
		}
	});


}

function step5B(config, data){


	nightmare
	.wait(1000)
	.insert('#finalize_sig', data.trim())
	.wait(1000)
	.click('#validate_finalize_sig')
	.wait(1000)
	.evaluate((selector, done) => {

		window.scrollTo(0,document.body.scrollHeight);

		function waitForStatus(){

			if (document.getElementById(selector)){

				var val = document.getElementById(selector).innerText.toLowerCase();
				if (val.split('proceed to next').length > 1){
					done(null, true);
					return;
				} else if (val.split('error').length > 1){
					done(null, false);
					return;
				} else {
					setTimeout(waitForStatus, 100);
				}
			} else {
				done(null, false);
			}

		}
		waitForStatus();
	}, 'validate_finalize_sig_status')
	.then(success => {
		if (success){
			step5C(config);
		} else {
			close(config);
		}
	});

}

function step5C(config, data){

	nightmare
	.wait(1000)
	.evaluate((selector, done) => {

		window.scrollTo(0,document.body.scrollHeight);

		var selField = document.getElementById(selector);
		done(null, (selField && !selField.disabled) ? selField.value : false);

		var checkForFieldVal = function(){
			if (document.getElementById(selector)){
				var result = document.getElementById(selector).value;
				if (result.split('-----BEGIN CERTIFICATE-----').length > 1) {
					done(null, result);
				} else {
					setTimeout(checkForFieldVal, 500);
				}
			} else {
				done(null, false);
			}
		}

		checkForFieldVal();

	}, 'crt')
	.then(signedCertChain => {
		if (signedCertChain !== false){

			step5D(config, signedCertChain)

		} else {
			close(config);
		}
	});
}

function step5D(config, signedCertChain){

	console.log('Signed Certificate Chain:')
	console.log(colors.yellow(signedCertChain))
	if (config.includePrivateKeyInOutput){
		console.log(colors.yellow(fs.readFileSync(path.join(config.workingDir, 'domain.key'), 'utf8')))
	}


	close(config)
}

// Utils
// -----

function close(config){

	nightmare
	.wait(5000)
	.end()
	.then(function (result) {
		 console.log('Done.')
	})
	.catch(function (error) {
	  console.error('Error:', error);
	});

}

function prepJSCmds(jsCmds){
	var cmdJS = jsCmds.join(';') + ';';
	cmdJS = cmdJS.split(';;').join(';');
	var js = 'javascript: '+cmdJS+' void 0';
	return js;
	//location.href=js;
}

module.exports = LetsEncryptAuto(process.cwd()); // pwd, this script is to be called within job dir
