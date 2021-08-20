'use strict';
const Router = require('../lib/routerSetup');
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
            expect(router.servers.length).eql(0);
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
            expect(router.servers.length).eql(1);
            expect(router.servers[0].options.beginIP).eql('192.168.4.2');
            expect(router.servers[0].options.endIP).eql('192.168.4.254');
            expect(router.servers[0].options.listenAddress).eql('192.168.4.1');
            done();
        });
    });
});