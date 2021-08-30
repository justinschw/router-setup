'use strict';
process.env.TESTENV = true;

const fs = require('fs');
const memfs = require('memfs');

memfs.mkdirSync(`${__dirname}/../lib/json`, {recursive: true});
memfs.mkdirSync('/etc/sysctl.d/', { recursive: true });
const firewallContents = fs.readFileSync(`${__dirname}/../lib/json/firewall.json`, 'utf-8');
memfs.writeFileSync(`${__dirname}/../lib/json/firewall.json`, firewallContents, 'utf-8');

const mockRequire = require('mock-require');
mockRequire('iptabler', function() {
    return {
        _args: [],
        exec: function() {
            return Promise.resolve();
        }
    }
})
const systemctl = require('systemctl');
const Netplan = require('netplan-config');
const DhcpServer = require('dhcpd-multi');
const Hostapd = require('hostapd-config');
const Router = require('../lib/routerSetup');
const sandbox = require('sinon').createSandbox();
const expect = require('chai').expect;

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

const defaultConfig = {
    wan: {
        iface: 'eth0',
            def: {
            dhcp: true
        }
    },
    lans: [
        {
            iface: 'eth1',
            network: '192.168.4.0'
        }
    ]
}

describe('/lib/routerSetup', function() {
    describe('constructor', function() {
        it('defaults', function(done) {
            const router = new Router(defaultConfig);
            expect(Object.keys(router.net.plan.network.ethernets).length).eql(2);
            expect(router.dhcp).undefined;
            expect(router.net.plan.network.ethernets.eth1.addresses[0]).eql('192.168.4.1/24')
            done();
        });

        it('dhcp', function(done) {
            let dhcp = clone(defaultConfig);
            dhcp.lans[0].dhcpServer = {
                domain: 'example.com'
            };
            const router = new Router(dhcp);
            expect(Object.keys(router.net.plan.network.ethernets).length).eql(2);
            expect(router.net.plan.network.ethernets.eth1.addresses[0]).eql('192.168.4.1/24')
            expect(router.dhcp.config.networks.length).eql(1);
            expect(router.dhcp.config.networks[0].beginIP).eql('192.168.4.2');
            expect(router.dhcp.config.networks[0].endIP).eql('192.168.4.254');
            expect(router.dhcp.config.networks[0].routers).eql('192.168.4.1');
            done();
        });
    });

    describe('deploy', function() {
        beforeEach(function() {
            sandbox.stub(Hostapd.prototype, 'restart').resolves();
            sandbox.stub(DhcpServer.prototype, 'deploy').resolves();
            sandbox.stub(Netplan.prototype, 'apply').resolves();
            sandbox.stub(systemctl, 'restart').resolves();
            sandbox.stub(Router.prototype, 'getAllRules').resolves();
            sandbox.stub(Router.prototype, 'applyRuleSafely').resolves();
        });

        afterEach(function() {
            sandbox.restore();
        });

        it('valid', async function() {
            const router = new Router(defaultConfig);
            await router.deploy();
        });
    });
});