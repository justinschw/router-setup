'use strict';

const joi = require('joi');
const Netplan = require('netplan-config');
const DhcpServer = require('dnsmasq-dhcp');
const {Netmask} = require('netmask');

function incrementIP(ip) {
    let parts = ip.split('.');
    parts[3] = `${parseInt(parts[3]+1)}`;
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
				listenAddress: lan.ip,
				domain: lan.domain
			};
			let dhcpServer = new DhcpServer(options);
			servers.push(dhcpServer);
			dnsPort += 1;
		}
		// TODO: Configure hostapd if necessary
		// TODO: Configure firewall
    });
    this.servers = servers;
}

Router.prototype.deploy = async function() {
	await this.net.apply();
	let dhcp = this.servers.map(server => {
		return server.start();
	});
	await Promise.all(dhcp);
	// TODO: start hostapd
	// TODO: Apply firewall rules
}

module.exports = Router;