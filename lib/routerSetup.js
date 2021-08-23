'use strict';

const joi = require('joi');
const Netplan = require('netplan-config');
const DhcpServer = require('dnsmasq-dhcp');
const iptabler = require('iptabler');
const {Netmask} = require('netmask');
const fs = require('fs');

const firewallRules = JSON.parse(fs.readFileSync(`${__dirname}/json/firewall.json`));

function clone(json, replacements) {
	let jsonStr = JSON.stringify(json);
	Object.keys(replacements).forEach(tag => {
		jsonStr.replace(tag, replacements[tag]);
	})
	return JSON.parse(jsonStr);
}

function incrementIP(ip) {
    let parts = ip.split('.');
    parts[3] = `${parseInt(parts[3])+1}`;
    return parts.join('.');
}

function Router(config) {
    const schema = joi.object({
		netplan: joi.object().default(null),
		wan: joi.object({
			iface: joi.string().min(1).default('eth0'),
			def: joi.object().default({
				dhcp: true
			})
		}).default(),
		lans: joi.array().items({
			iface: joi.string().min(1).required(),
			dhcpServer: joi.object({
				beginIP: joi.string().ip().optional(),
				endIP: joi.string().ip().optional(),
				domain: joi.string().domain().required()
			}).optional(),
			network: joi.string().ip().required(),
			prefix: joi.number().min(0).max(32).default(24),
			ip: joi.string().ip().optional(),
			accessPoint: joi.object({
				ssid: joi.string().min(1).required(),
				password: joi.string().min(1).required()
			}).optional()
		})
    }).default();

    this.config = joi.attempt(config, schema);
    this.net = new Netplan(this.config.netplan);

    // Configure the WAN interface
    this.net.configureInterface(
	this.config.wan.iface,
	this.config.wan.def
    );
    // Configure the LAN interfaces
    let dnsPort = 5353;
    let servers = [];
    this.config.lans.forEach(lan => {
		let netmask = new Netmask(`${lan.network}/${lan.prefix}`);
		let ip = lan.ip || netmask.first;
		// Configure a static interface
		let def = {
			ip,
			prefix: lan.prefix
		}
		this.net.configureInterface(lan.iface, def)
		// Configure the DHCP server
		if (lan.dhcpServer) {
			let beginIP = lan.dhcpServer.beginIP || incrementIP(netmask.first);
			let endIP = lan.dhcpServer.endIP || netmask.last;
			let options = {
				interface: lan.iface,
				beginIP,
				endIP,
				netmask: netmask.mask,
				port: dnsPort,
				listenAddress: ip,
				domain: lan.dhcpServer.domain
			};
			let dhcpServer = new DhcpServer(options);
			servers.push(dhcpServer);
			dnsPort += 1;
		}
		// TODO: Configure hostapd if necessary
    });
    this.servers = servers;
}

/*
 * Deploy router
 */
Router.prototype.deploy = async function() {
	await this.net.apply();
	let dhcp = this.servers.map(server => {
		return server.start();
	});
	await Promise.all(dhcp);
	// TODO: start hostapd
	// TODO: enable forwarding
	// Apply firewall rules
	await this.initChains();
	await this.flushAllChains();
	for (let i = 0; i < this.config.lans.length; i++) {
		const lan = this.config.lans[i];
		let ingressRules = clone(firewallRules.ingress, {
			'WAN': this.config.wan.iface,
			'LAN': lan.iface,
			'GATEWAY_IP': lan.ip
		});
		let egressRules = clone(firewallRules.egress, {
			'WAN': this.config.wan.iface
		});
		await this.applyRules(ingressRules);
		await this.applyRules(egressRules);
	}
}

/*
 * Firewall related
 */
Router.prototype.flushChain = async function(chain, nat) {
	let rule = {
		sudo: true,
		flush: chain
	};
	if (nat) {
		rule.table = 'nat';
	}
	await iptabler(rule).exec(err => {
		if (err) {
			console.error(`Error flushing chain ${chain} :: ${err.message}`)
		}
	});
}

Router.prototype.flushAllChains = async function() {
	await this.flushChain('ROUTER-INGRESS', true);
	await this.flushChain('ROUTER-FORWARD');
	await this.flushChain('ROUTER-EGRESS', true);
}

Router.prototype.initChains = async function() {
	// Only create chains/rules if they don't already exist
	await this.getAllRules();
	await this.applyRulesSafely(firewallRules.createAll);
}

Router.prototype.removeChains = async function() {
	await this.flushAllChains();
	await this.applyRules(firewallRules.deleteAll);
}

Router.prototype.getAllRules = async function() {
	let router = this;
	// First get a list of all existing rules
	const allRulesCmd = iptabler({
		sudo: true,
		S: ''
	});
	const allNatRulesCmd = iptabler({
		sudo: true,
		table: 'nat',
		S: ''
	});
	allRulesCmd._args.pop();
	allNatRulesCmd._args.pop();
	await allRulesCmd.exec(function(err, stdout) {
		if (err) {
			throw err;
		}
		router.allRules = stdout.split('\n');
	});
	await allNatRulesCmd.exec(function(err, stdout) {
		if (err) {
			throw err;
		}
		router.allNatRules = stdout.split('\n');
	});
};

Router.prototype.applyRuleSafely = async function(rule) {
	const iptablesRule = iptabler(rule);
	let cmd = iptablesRule._args.slice();
	cmd.shift();
	let ruleStr = cmd.join(' ');

	let ruleExists = false;
	if (ruleStr.indexOf('-t nat') >= 0) {
		// This is a nat rule
		ruleStr = ruleStr.replace('-t nat', '').trim();
		ruleExists = this.allNatRules.indexOf(ruleStr) >= 0;
	} else {
		ruleExists = this.allRules.indexOf(ruleStr) >= 0;
	}

	// Apply rule only if it doesn't already exist
	if (!ruleExists) {
		console.log('applying rule');
		await this.applyRule(rule);
	} else {
		console.log('Rule already applied');
	}
};

Router.prototype.applyRulesSafely = async function(rules) {
	for (let i = 0; i < rules.length; i++) {
		await this.applyRuleSafely(rules[i]);
	}
};

// This one is unsafe
Router.prototype.applyRule = async function(rule) {
	await iptabler(rule).exec(function(stdout, err) {
		if(err) {
			throw err;
		}
	});
}

Router.prototype.applyRules = async function(rules) {
	for (let i = 0; i < rules.length; i++) {
		await this.applyRule(rules[i]);
	}
}

module.exports = Router;