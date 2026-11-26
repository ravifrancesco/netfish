// netfish-tunnel: WireGuard inside the Netfish apps (Android, Mac, Windows, iPhone), for reaching the
// server away from home without a VPN on the whole device.
//
// The app starts it and writes a WireGuard configuration on stdin (wg-quick's format, as a
// router or wg-easy gives it), ending with a line ".". "-dns a,b" names the device's DNS servers
// (Android: a Linux build can't find them itself); "-check" only reads the configuration and
// says "OK" or "ERROR <reason>". It connects in user space (no system VPN,
// nothing else on the device goes through it) and serves an HTTP proxy on 127.0.0.1: requests
// for the tunnel's addresses (AllowedIPs) go through WireGuard unless they answer directly (back
// at home), the rest straight out. It prints
// "PORT <n>" once it's listening, or "ERROR <reason>" and exits, and exits when stdin closes (the
// app has gone). It never prints keys. The iPhone app can't start programs: it has this built in
// (ios.go) and calls it directly.
//
// Apple's video player can't use a proxy, so the proxy also forwards plain requests:
// http://127.0.0.1:<port>/through/<host:port>/<path> is http://<host:port>/<path>, the same way.
package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"
)

// config is what matters of a wg-quick file.
type config struct {
	privateKey string
	addresses  []netip.Addr
	dns        []netip.Addr
	mtu        int
	peers      []peer
}

type peer struct {
	publicKey    string
	presharedKey string
	endpoint     string
	allowed      []netip.Prefix
	keepalive    int
}

// keyHex turns a WireGuard key (base64, as configurations have it) into hex (as wireguard-go wants it).
func keyHex(name, key string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(key))
	if err != nil || len(raw) != 32 {
		return "", fmt.Errorf("%s isn't a WireGuard key", name)
	}
	return hex.EncodeToString(raw), nil
}

func list(value string) []string {
	var out []string
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func parse(text string) (*config, error) {
	c := &config{mtu: 1420}
	section := ""
	var p *peer
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if i := strings.IndexAny(line, "#;"); i >= 0 {
			line = strings.TrimSpace(line[:i])
		}
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") {
			section = strings.ToLower(strings.Trim(line, "[] "))
			if section == "peer" {
				c.peers = append(c.peers, peer{})
				p = &c.peers[len(c.peers)-1]
			}
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("can't read the line %q", strings.TrimSpace(key))
		}
		key, value = strings.ToLower(strings.TrimSpace(key)), strings.TrimSpace(value)
		var err error
		switch {
		case section == "interface" && key == "privatekey":
			c.privateKey, err = keyHex("PrivateKey", value)
		case section == "interface" && key == "address":
			for _, a := range list(value) {
				prefix, perr := netip.ParsePrefix(a)
				if perr != nil {
					addr, aerr := netip.ParseAddr(a)
					if aerr != nil {
						return nil, fmt.Errorf("Address %q isn't an address", a)
					}
					prefix = netip.PrefixFrom(addr, addr.BitLen())
				}
				c.addresses = append(c.addresses, prefix.Addr())
			}
		case section == "interface" && key == "dns":
			for _, d := range list(value) {
				if addr, derr := netip.ParseAddr(d); derr == nil {
					c.dns = append(c.dns, addr) // (search domains are left out)
				}
			}
		case section == "interface" && key == "mtu":
			c.mtu, err = strconv.Atoi(value)
		case section == "peer" && key == "publickey":
			p.publicKey, err = keyHex("PublicKey", value)
		case section == "peer" && key == "presharedkey":
			p.presharedKey, err = keyHex("PresharedKey", value)
		case section == "peer" && key == "endpoint":
			p.endpoint = value
		case section == "peer" && key == "allowedips":
			for _, a := range list(value) {
				prefix, perr := netip.ParsePrefix(a)
				if perr != nil {
					return nil, fmt.Errorf("AllowedIPs %q isn't a network", a)
				}
				p.allowed = append(p.allowed, prefix.Masked())
			}
		case section == "peer" && key == "persistentkeepalive":
			p.keepalive, err = strconv.Atoi(value)
		}
		if err != nil {
			return nil, err
		}
	}
	switch {
	case c.privateKey == "":
		return nil, errors.New("no PrivateKey under [Interface]")
	case len(c.addresses) == 0:
		return nil, errors.New("no Address under [Interface]")
	case len(c.peers) == 0:
		return nil, errors.New("no [Peer]")
	}
	for _, p := range c.peers {
		if p.publicKey == "" || p.endpoint == "" || len(p.allowed) == 0 {
			return nil, errors.New("a [Peer] needs PublicKey, Endpoint and AllowedIPs")
		}
	}
	return c, nil
}

// uapi is the configuration in wireguard-go's own terms.
func (c *config) uapi() (string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "private_key=%s\n", c.privateKey)
	for _, p := range c.peers {
		endpoint, err := net.ResolveUDPAddr("udp", p.endpoint)
		if err != nil {
			return "", fmt.Errorf("can't find %s", p.endpoint)
		}
		fmt.Fprintf(&b, "public_key=%s\n", p.publicKey)
		if p.presharedKey != "" {
			fmt.Fprintf(&b, "preshared_key=%s\n", p.presharedKey)
		}
		fmt.Fprintf(&b, "endpoint=%s\n", endpoint.String())
		if p.keepalive > 0 {
			fmt.Fprintf(&b, "persistent_keepalive_interval=%d\n", p.keepalive)
		}
		for _, a := range p.allowed {
			fmt.Fprintf(&b, "allowed_ip=%s\n", a.String())
		}
	}
	return b.String(), nil
}

// tunnel decides, for each connection, WireGuard or straight out.
type tunnel struct {
	net     *netstack.Net
	allowed []netip.Prefix
	dns     bool
	direct  net.Dialer
	forward *httputil.ReverseProxy

	// The tunnel's addresses that answered directly (at home after all), or didn't, and when that
	// was found out: looked at again in the background now and then, never holding a connection up.
	mu     sync.Mutex
	routes map[string]route
}

type route struct {
	home bool
	at   time.Time
}

const recheck = time.Minute

func answers(address string) bool {
	c, err := net.DialTimeout("tcp", address, 1500*time.Millisecond)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// home: this address of the tunnel's answers directly (the device is at home): no need for WireGuard.
func (t *tunnel) home(address string) bool {
	t.mu.Lock()
	r, known := t.routes[address]
	t.mu.Unlock()
	if !known {
		r = route{home: answers(address), at: time.Now()}
	} else if time.Since(r.at) > recheck {
		r.at = time.Now()
		go func() {
			fresh := route{home: answers(address), at: time.Now()}
			t.mu.Lock()
			t.routes[address] = fresh
			t.mu.Unlock()
		}()
	}
	t.mu.Lock()
	t.routes[address] = r
	t.mu.Unlock()
	return r.home
}

// through: the tunnel for this address of its own, unless it answers directly.
func (t *tunnel) through(ctx context.Context, network, address string) (net.Conn, error) {
	if t.home(address) {
		return t.direct.DialContext(ctx, network, address)
	}
	return t.net.DialContext(ctx, network, address)
}

func (t *tunnel) inside(addr netip.Addr) bool {
	addr = addr.Unmap()
	for _, p := range t.allowed {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

func (t *tunnel) dial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	if addr, perr := netip.ParseAddr(host); perr == nil {
		if t.inside(addr) {
			return t.through(ctx, network, address)
		}
		return t.direct.DialContext(ctx, network, address)
	}
	// A name: the home network's DNS (through the tunnel) when the configuration has one, else the device's.
	var addrs []string
	if t.dns {
		addrs, _ = t.net.LookupContextHost(ctx, host)
	}
	if len(addrs) == 0 {
		addrs, _ = net.DefaultResolver.LookupHost(ctx, host)
	}
	for _, a := range addrs {
		if addr, perr := netip.ParseAddr(a); perr == nil && t.inside(addr) {
			return t.through(ctx, network, net.JoinHostPort(a, port))
		}
	}
	return t.direct.DialContext(ctx, network, address)
}

// ServeHTTP: CONNECT (anything, https included) is joined up end to end; plain http is forwarded.
func (t *tunnel) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		t.connect(w, r)
		return
	}
	if !r.URL.IsAbs() {
		// /through/<host:port>/<path>: that address's <path>, as if asked for it there.
		rest, ok := strings.CutPrefix(r.URL.Path, "/through/")
		host, path, _ := strings.Cut(rest, "/")
		if !ok || host == "" {
			http.Error(w, "netfish-tunnel is a proxy", http.StatusBadRequest)
			return
		}
		r.URL.Scheme, r.URL.Host, r.URL.Path, r.URL.RawPath = "http", host, "/"+path, ""
		r.Host = host
	}
	t.forward.ServeHTTP(w, r)
}

func (t *tunnel) connect(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	upstream, err := t.dial(ctx, "tcp", r.Host)
	cancel()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		upstream.Close()
		http.Error(w, "can't take over the connection", http.StatusInternalServerError)
		return
	}
	client, rw, err := hijacker.Hijack()
	if err != nil {
		upstream.Close()
		return
	}
	_, _ = client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
	var once sync.Once
	done := func() {
		once.Do(func() {
			client.Close()
			upstream.Close()
		})
	}
	go func() {
		// What the client already sent along with CONNECT, then the rest.
		if n := rw.Reader.Buffered(); n > 0 {
			buffered, _ := rw.Reader.Peek(n)
			_, _ = upstream.Write(buffered)
		}
		_, _ = io.Copy(upstream, client)
		done()
	}()
	_, _ = io.Copy(client, upstream)
	done()
}

func fail(err error) {
	fmt.Println("ERROR " + err.Error())
	os.Exit(1)
}

// useDNS: names looked up with these servers (the device's), not what the system says.
func useDNS(servers []string) {
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			var last error
			for _, s := range servers {
				c, err := d.DialContext(ctx, network, net.JoinHostPort(s, "53"))
				if err == nil {
					return c, nil
				}
				last = err
			}
			return nil, last
		},
	}
}

// start: WireGuard up with this configuration, and its proxy listening on 127.0.0.1. Stopping
// closes both.
func start(c *config) (port int, stop func(), err error) {
	settings, err := c.uapi()
	if err != nil {
		return 0, nil, err
	}
	tun, tnet, err := netstack.CreateNetTUN(c.addresses, c.dns, c.mtu)
	if err != nil {
		return 0, nil, err
	}
	dev := device.NewDevice(tun, conn.NewDefaultBind(), device.NewLogger(device.LogLevelSilent, ""))
	if err := dev.IpcSet(settings); err != nil {
		dev.Close()
		return 0, nil, errors.New("WireGuard didn't take the configuration")
	}
	if err := dev.Up(); err != nil {
		dev.Close()
		return 0, nil, err
	}
	var allowed []netip.Prefix
	for _, p := range c.peers {
		allowed = append(allowed, p.allowed...)
	}
	t := &tunnel{net: tnet, allowed: allowed, dns: len(c.dns) > 0, direct: net.Dialer{Timeout: 20 * time.Second}, routes: map[string]route{}}
	t.forward = &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL = pr.In.URL
			pr.Out.Host = pr.In.Host
		},
		Transport: &http.Transport{
			DialContext:         t.dial,
			MaxIdleConnsPerHost: 8,
			IdleConnTimeout:     90 * time.Second,
		},
		// Films stream: pass every byte on as it comes.
		FlushInterval: -1,
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		dev.Close()
		return 0, nil, err
	}
	go func() { _ = http.Serve(listener, t) }()
	var once sync.Once
	return listener.Addr().(*net.TCPAddr).Port, func() {
		once.Do(func() {
			listener.Close()
			dev.Close()
		})
	}, nil
}

func main() {
	dns := flag.String("dns", "", "the device's DNS servers, comma separated")
	check := flag.Bool("check", false, "only check the configuration")
	flag.Parse()
	if servers := list(*dns); len(servers) > 0 {
		useDNS(servers)
	}
	// The configuration, up to a line ".".
	in := bufio.NewReader(os.Stdin)
	var text strings.Builder
	for {
		line, err := in.ReadString('\n')
		if strings.TrimSpace(line) == "." {
			break
		}
		text.WriteString(line)
		if err != nil {
			fail(errors.New("the configuration ended early"))
		}
	}
	c, err := parse(text.String())
	if err != nil {
		fail(err)
	}
	if *check {
		fmt.Println("OK")
		return
	}
	port, stop, err := start(c)
	if err != nil {
		fail(err)
	}
	fmt.Printf("PORT %d\n", port)
	// The app gone (stdin closed): so is the tunnel.
	_, _ = io.Copy(io.Discard, in)
	stop()
}
