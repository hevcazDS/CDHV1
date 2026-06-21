{
  description = "Julio Cepeda Bot + Dashboard - NixOS Development Environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.11";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          name = "julio-cepeda-dev";

          buildInputs = with pkgs; [
            nodejs_20
            npm
            python3
            pkg-config
            sqlite
            chromium
            stdenv.cc.cc.lib
          ];

          shellHook = ''
            echo "🤖 Julio Cepeda Bot - NixOS Dev Shell"
            echo "Node: $(node --version)"
            echo "npm: $(npm --version)"
            echo "Python: $(python3 --version)"
            echo ""
            echo "Primer uso:  nix run .#instalar"
            echo "Arrancar:    nix run .#iniciar   (o ./iniciar-nixos-chatbot.sh)"
            echo "Apagar:      nix run .#detener    (o ./detener-nixos-chatbot.sh)"
          '';
        };

        # "Ejecutables" de un solo comando (nix run .#instalar / .#iniciar /
        # .#detener), equivalentes a los .bat de Windows pero como scripts
        # de shell — mismo criterio anti-falso-positivo de antivirus que
        # instalador-windows-chatbot.ps1: texto plano, nada empaquetado.
        # writeShellApplication mete node/npm/chromium en el PATH del script
        # sin depender de que ya estés dentro de `nix develop`.
        apps =
          let
            runtimeInputs = with pkgs; [ nodejs_20 python3 pkg-config sqlite chromium ];
            repoDir = toString ./.;
          in {
            instalar = {
              type = "app";
              program = "${pkgs.writeShellApplication {
                name = "instalar-chatbot";
                inherit runtimeInputs;
                text = ''cd "${repoDir}" && exec bash ./instalador-nixos-chatbot.sh "$@"'';
              }}/bin/instalar-chatbot";
            };
            iniciar = {
              type = "app";
              program = "${pkgs.writeShellApplication {
                name = "iniciar-chatbot";
                inherit runtimeInputs;
                text = ''cd "${repoDir}" && exec bash ./iniciar-nixos-chatbot.sh "$@"'';
              }}/bin/iniciar-chatbot";
            };
            detener = {
              type = "app";
              program = "${pkgs.writeShellApplication {
                name = "detener-chatbot";
                inherit runtimeInputs;
                text = ''cd "${repoDir}" && exec bash ./detener-nixos-chatbot.sh "$@"'';
              }}/bin/detener-chatbot";
            };
          };
      }
    );
}