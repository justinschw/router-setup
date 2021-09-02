'use strict';

const joi = require('joi');
const Netplan = require('netplan-config');
const DhcpServer = require('dhcpd-multi');
const Hostapd = require('hostapd-config');
const FW = require('iptabler-smart');
const { Netmask } = require('netmask');
const systemctl = require('systemctl');
const fs = (process.env.TESTENV) ? require('memfs') : require('fs');

const firewallRules = JSON.parse(fs.readFileSync(`${__dirname}/json/firewall.json`));

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
			dhcpServer: joi.object().optional(),
			network: joi.string().ip().required(),
			prefix: joi.number().min(0).max(32).default(24),
			ip: joi.string().ip().optional(),
			accessPoint: joi.object().optional()
		})
    }).default();

    this.config = joi.attempt(config, schema, {allowUnknown: true, stripUnknown: false});
    this.net = new Netplan(this.config.netplan);
    this.net.loadConfig();

    // Configure the WAN interface
    this.net.configureInterface(
		this.config.wan.iface,
		this.config.wan.def
    );
    // Configure the LAN interfaces
    let wifis = [];
    let wan = this.config.wan;
    let dhcpHomes = [];
    this.config.lans.forEach(lan => {
        if (lan.iface === wan.iface) {
            throw new Error(`Error: WAN iface "${wan.iface}" same as LAN iface`);
	    }
		let netmask = new Netmask(`${lan.network}/${lan.prefix}`);
		let ip = lan.ip || netmask.first;
		lan.ip = ip;
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
				iface: lan.iface,
				beginIP,
				endIP,
				netmask: netmask.mask,
				subnet: lan.network,
				routers: ip,
				domainName: lan.dhcpServer.domain,
				nameservers: lan.dhcpServer.nameservers || [ip]
			};
			dhcpHomes.push(options);
		}
		// Configure hostapd if necessary
		if (lan.accessPoint) {
			lan.accessPoint.iface = lan.iface;
			let hostapdServer = new Hostapd(lan.accessPoint);
			wifis.push(hostapdServer);
		}
    });

    if (dhcpHomes.length > 0) {
		this.dhcp = new DhcpServer({
			networks: dhcpHomes
		});
	}
    this.wifis = wifis;
    this.fw = new FW();
}

/*
 * Deploy router
 */
Router.prototype.deploy = async function() {
	await this.net.apply();

	// Start dhcp on LANS
	if (this.dhcp) {
		await this.dhcp.deploy()
	}

	// Start hostapd on WiFi LANS
	let hostapd = this.wifis.map(wifi => {
		return wifi.restart();
	});
	await Promise.all(hostapd);

	// Enable forwarding
	if (!fs.existsSync('/etc/sysctl.d/routed-ap.conf')) {
		fs.writeFileSync('/etc/sysctl.d/routed-ap.conf', 'net.ipv4.ip_forward=1');
		await systemctl.restart('procps');
	}

	// Apply firewall rules
	await this.initChains();
	await this.flushAllChains();

	for (let i = 0; i < this.config.lans.length; i++) {
		const lan = this.config.lans[i];
		await this.fw.applyRules(firewallRules.ingress, {
			'WAN': this.config.wan.iface,
			'LAN': lan.iface,
			'GATEWAY_IP': lan.ip
		});
	}
	// Only need one egress rule for WAN
	await this.fw.applyRules(firewallRules.egress, {
		'WAN': this.config.wan.iface
	});
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
	await this.fw.applyRule(rule);
}

Router.prototype.flushAllChains = async function() {
	await this.flushChain('ROUTER-INGRESS', true);
	await this.flushChain('ROUTER-FORWARD');
	await this.flushChain('ROUTER-EGRESS', true);
}

Router.prototype.initChains = async function() {
	// Only create chains/rules if they don't already exist
	await this.fw.applyRulesSafely(firewallRules.createAll);
}

Router.prototype.removeChains = async function() {
	await this.flushAllChains();
	await this.fw.applyRules(firewallRules.deleteAll);
}

module.exports = Router;
