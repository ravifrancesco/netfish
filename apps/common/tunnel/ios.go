//go:build ios

package main

// The iPhone app's way in (it can't start programs): built with -buildmode=c-archive and linked
// into the app. One tunnel at a time.

/*
#include <stdlib.h>
*/
import "C"

import (
	"sync"
	"unsafe"
)

var (
	mu      sync.Mutex
	running func()
)

func reason(err error) *C.char {
	if err == nil {
		return nil
	}
	return C.CString(err.Error())
}

// NetfishTunnelCheck: nil if the configuration is usable, else what's wrong (free it).
//
//export NetfishTunnelCheck
func NetfishTunnelCheck(text *C.char) *C.char {
	_, err := parse(C.GoString(text))
	return reason(err)
}

// NetfishTunnelStart: the proxy's port (a tunnel already running is stopped first), or 0 and what
// went wrong in *problem (free it).
//
//export NetfishTunnelStart
func NetfishTunnelStart(text *C.char, problem **C.char) C.int {
	mu.Lock()
	defer mu.Unlock()
	if running != nil {
		running()
		running = nil
	}
	c, err := parse(C.GoString(text))
	if err != nil {
		*problem = reason(err)
		return 0
	}
	port, stop, err := start(c)
	if err != nil {
		*problem = reason(err)
		return 0
	}
	running = stop
	return C.int(port)
}

//export NetfishTunnelStop
func NetfishTunnelStop() {
	mu.Lock()
	defer mu.Unlock()
	if running != nil {
		running()
		running = nil
	}
}

//export NetfishTunnelFree
func NetfishTunnelFree(s *C.char) { C.free(unsafe.Pointer(s)) }
