'use strict';
const Router = require('../lib/routerSetup');
const expect = require('chai').expect;

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
            done();
        });
    });
});