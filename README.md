# router-setup
NPM library to set up a quick and easy linux router.
This was originally written and tested for raspberry pi running debian. But it should work on any system as
long as you have the packages installed.

## Modules used
* [netplan-config](https://www.npmjs.com/package/netplan-config)
* [hostapd-config] (https://www.npmjs.com/package/hostapd-config)
* [dhcpd-multi] (https://www.npmjs.com/package/dhcpd-multi)
* [iptabler] (https://www.npmjs.com/package/iptabler)

**_Note_**: Be sure to read the documentation for the above if you want to do custom configurations

## Linux packages needed
You will need these installed on your system in order for everything to work.
* Node.js and NPM (obviously)
* netplan.io
* isc-dhcp-server
* hostapd
* iptables

## What it does
This library will set up your device as a router by doing the following:
* Configures the WAN and LAN interfaces using [**netplan**](https://netplan.io/)
* Configures DHCP servers on the LANs where desired
* Configures hostapd on the wireless LANs
* Configures iptables rules to forward LAN traffic to WAN, and masquerade outgoing on WAN
* Enables IPv4 forwarding

**_Note_**: IPv6 not currently supported
**_Note_**: currently this library doesn't set up a DNS server on your router. If you want that, you will have to do it yourself.

## Usage
```
const Router = require('router-setup');
 
const router = new Router({
  wan: {
    iface: 'eth0',
    def: {
        ip: '192.168.4.102',
        defaultGateway: '192.168.4.1',
        nameservers: ['192.168.4.1'],
        domain: 'guardian-angel.local'
    }
  },
  lans: [
    {
      iface: 'eth1',
      network: '192.168.5.0',
      dhcpServer: {
        beginIP: '192.168.5.2',
        endIP: '192.168.5.254',
        domain: 'guardian-angel.local',
        nameservers: ['8.8.8.8', '8.8.4.4']
      },
      ip: '192.168.5.1'
    },
    {
      iface: 'wlan0',
	  network: '192.168.6.0',
	  dhcpServer: {
	    domain: 'guardian-angel.local'
      },
      accessPoint: {
        ssid: 'FBI Surveillance Van',
        wpaPassphrase: 'supersecretpassword'
      }
    }
  ]
});

router.deploy().then(() => {
  console.log('deployed successfully');
});
```

## Options fields
* _netplan_ (optional) - This is an optional custom **netplan-config** config object. See **netplan-config** module documentation for more details.
* _wan_ - This defines the WAN interface. It contains an _iface_ field and a _def_ field which represents a **netplan-config** interface definition. (Again, see **netplan-config**)
* _lans_ - This is a list of LANs that you will be serving internet to. The fields will be described in the section below.

## LAN fields
* _iface_ - interface that is being served (required)
* _network_ - subnet that you are running on (required)
* _prefix_ - integer representing subnet prefix length (default is 24)
* _ip_ - the IP for the router on that interface. This will be the gateway IP for your clients. By default, it is the first IP in the subnet block.
* _accessPoint_ - If you are running a WiFi access point, this contains the _ssid_ and _wpaPassphrase_ for your wifi network. This is basically a config object for the **hostapd-config** module. See its documentation for more details.
* _dhcpServer_ - This is a config object for the **dhcpd-multi** module, see its documentation for details. By default, the DHCP range is from the second IP to the last IP in the subnet block.

**_Note_**: By default the nameservers list for _dhcpServer_ is set to simply your configured router's IP. If you don't set this manually, then you have to make sure DNS is up and running on your router. Otherwise you better specify this manually.