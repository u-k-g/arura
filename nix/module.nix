self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.arura;
  inherit (lib.options) mkEnableOption mkOption;
  inherit (lib.modules) mkIf;
  inherit (lib.types)
    str
    port
    package
    path
    ;
  inherit (lib.meta) getExe;
in
{
  options.services.arura = {
    enable = mkEnableOption "Arura Hermes web client";
    package = mkOption {
      type = package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.arura;
      description = "Built Arura application package.";
    };
    convexPackage = mkOption {
      type = package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.convex;
    };
    port = mkOption {
      type = port;
      default = 4100;
    };
    convexPort = mkOption {
      type = port;
      default = 3210;
    };
    convexSitePort = mkOption {
      type = port;
      default = 3211;
    };
    publicUrl = mkOption {
      type = str;
      description = "Browser-visible Arura origin.";
    };
    convexPublicUrl = mkOption {
      type = str;
      description = "Browser-visible Convex origin.";
    };
    hermesUrl = mkOption {
      type = str;
      default = "http://127.0.0.1:9119";
    };
    environmentFile = mkOption {
      type = path;
      description = "Private runtime credentials file; do not put secret contents in the Nix store.";
    };
    convexEnvironmentFile = mkOption {
      type = path;
      description = "Private file containing CONVEX_INSTANCE_NAME and CONVEX_INSTANCE_SECRET.";
    };
  };
  config = mkIf cfg.enable {
    systemd.services.arura-convex = {
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      environment = {
        DISABLE_BEACON = "1";
      };
      serviceConfig = {
        DynamicUser = true;
        StateDirectory = "arura-convex";
        WorkingDirectory = "%S/arura-convex";
        EnvironmentFile = cfg.convexEnvironmentFile;
        ExecStart = "${getExe cfg.convexPackage} --interface 127.0.0.1 --port ${toString cfg.convexPort} --site-proxy-port ${toString cfg.convexSitePort} --convex-origin ${lib.escapeShellArg cfg.convexPublicUrl} --instance-name \${CONVEX_INSTANCE_NAME} --instance-secret \${CONVEX_INSTANCE_SECRET} --disable-beacon --redact-logs-to-client";
        Restart = "on-failure";
        UMask = "0077";
        NoNewPrivileges = true;
      };
    };
    systemd.services.arura = {
      wantedBy = [ "multi-user.target" ];
      after = [
        "network.target"
        "arura-convex.service"
      ];
      wants = [ "arura-convex.service" ];
      environment = {
        ARURA_PORT = toString cfg.port;
        ARURA_PUBLIC_URL = cfg.publicUrl;
        ARURA_AUTH_ISSUER = cfg.publicUrl;
        ARURA_STATE_DIR = "%S/arura";
        DENO_DIR = "%C/arura/deno";
        CONVEX_URL = "http://127.0.0.1:${toString cfg.convexPort}";
        CONVEX_PUBLIC_URL = cfg.convexPublicUrl;
        HERMES_URL = cfg.hermesUrl;
      };
      serviceConfig = {
        DynamicUser = true;
        StateDirectory = "arura";
        CacheDirectory = "arura";
        EnvironmentFile = cfg.environmentFile;
        ExecStart = getExe cfg.package;
        Restart = "on-failure";
        UMask = "0077";
        NoNewPrivileges = true;
      };
    };
  };
}
