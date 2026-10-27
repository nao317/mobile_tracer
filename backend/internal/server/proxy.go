package server

import (
	"net"

	"github.com/labstack/echo/v5"
)

// ConfigureProxy accepts forwarding headers only from explicitly trusted peers.
func ConfigureProxy(e *echo.Echo, ranges []*net.IPNet) {
	options := []echo.TrustOption{
		echo.TrustLoopback(false), echo.TrustLinkLocal(false), echo.TrustPrivateNet(false),
	}
	for _, network := range ranges {
		options = append(options, echo.TrustIPRange(network))
	}
	e.IPExtractor = echo.ExtractIPFromRealIPHeader(options...)
	e.SchemeExtractor = echo.ExtractSchemeFromHeaders(options...)
}
