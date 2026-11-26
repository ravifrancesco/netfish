// netfish-tunnel (apps/common/tunnel/ios.go), built into the app by tunnel/build.sh.
// Strings it returns are freed with NetfishTunnelFree.
char *NetfishTunnelCheck(char *text);
int NetfishTunnelStart(char *text, char **problem);
void NetfishTunnelStop(void);
void NetfishTunnelFree(char *s);
