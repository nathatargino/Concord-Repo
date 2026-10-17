#!/usr/bin/env node

/**
 * verify_msix.mjs — Automated verification of AppX/MSIX manifest configuration and assets.
 * 
 * Validates:
 * 1. client/package.json build.appx configuration:
 *    - identityName === 'NathSTargino.Concord-VoiceChat'
 *    - publisher === 'CN=23A8D0D4-5602-4BD4-B2DB-B1D23E5F8436'
 *    - artifactName === 'Concord-Store.msix'
 *    - publisherDisplayName, displayName, applicationId, backgroundColor
 *    - build.protocols includes 'concord'
 * 2. client/build/appx asset files:
 *    - Existence, PNG validity, and exact required dimensions:
 *      - Square44x44Logo.png (44x44)
 *      - Square150x150Logo.png (150x150)
 *      - StoreLogo.png (50x50)
 *      - LargeTile.png (310x310)
 *      - SmallTile.png (71x71)
 *      - BadgeLogo.png (24x24)
 *      - Wide310x150Logo.png (310x150)
 *      - SplashScreen.png (620x300)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(clientDir, 'package.json');
const appxDir = path.join(clientDir, 'build', 'appx');

let errors = 0;
let passed = 0;

function logPass(msg) {
    passed++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m: ${msg}`);
}

function logFail(msg) {
    errors++;
    console.error(`  \x1b[31m✖ FAIL\x1b[0m: ${msg}`);
}

function getPngDimensions(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const buf = fs.readFileSync(filePath);
    if (buf.length < 24) {
        return null;
    }
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
                  buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
    if (!isPng) {
        return { isPng: false, width: 0, height: 0, size: buf.length };
    }
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { isPng: true, width, height, size: buf.length };
}

console.log('\n============================================================');
console.log('  CONCORD — Verificação Automatizada AppX / MSIX & Assets');
console.log('============================================================\n');

// 1. Verificar client/package.json
console.log('[1/2] Verificando configuração AppX/MSIX em client/package.json...');

if (!fs.existsSync(packageJsonPath)) {
    logFail(`package.json não encontrado em: ${packageJsonPath}`);
} else {
    try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const build = pkg.build || {};
        const appx = build.appx || {};

        // Identity Name
        const expectedIdentity = 'NathSTargino.Concord-VoiceChat';
        if (appx.identityName === expectedIdentity) {
            logPass(`appx.identityName: "${appx.identityName}"`);
        } else {
            logFail(`appx.identityName esperado "${expectedIdentity}", recebido: "${appx.identityName}"`);
        }

        // Publisher
        const expectedPublisher = 'CN=23A8D0D4-5602-4BD4-B2DB-B1D23E5F8436';
        if (appx.publisher === expectedPublisher) {
            logPass(`appx.publisher: "${appx.publisher}"`);
        } else {
            logFail(`appx.publisher esperado "${expectedPublisher}", recebido: "${appx.publisher}"`);
        }

        // Artifact Name
        const expectedArtifact = 'Concord-Store.msix';
        if (appx.artifactName === expectedArtifact) {
            logPass(`appx.artifactName: "${appx.artifactName}"`);
        } else {
            logFail(`appx.artifactName esperado "${expectedArtifact}", recebido: "${appx.artifactName}"`);
        }

        // ApplicationId
        if (appx.applicationId === 'App') {
            logPass(`appx.applicationId: "${appx.applicationId}"`);
        } else {
            logFail(`appx.applicationId esperado "App", recebido: "${appx.applicationId}"`);
        }

        // BackgroundColor
        if (appx.backgroundColor && /^#[0-9a-fA-F]{6}$/.test(appx.backgroundColor)) {
            logPass(`appx.backgroundColor: "${appx.backgroundColor}"`);
        } else {
            logFail(`appx.backgroundColor inválido: "${appx.backgroundColor}"`);
        }

        // Display Name & Publisher Display Name
        if (appx.displayName) {
            logPass(`appx.displayName: "${appx.displayName}"`);
        } else {
            logFail(`appx.displayName está ausente`);
        }

        if (appx.publisherDisplayName) {
            logPass(`appx.publisherDisplayName: "${appx.publisherDisplayName}"`);
        } else {
            logFail(`appx.publisherDisplayName está ausente`);
        }

        // Protocol registration
        const protocols = build.protocols || [];
        const hasConcordProtocol = protocols.some(p => p.schemes && p.schemes.includes('concord'));
        if (hasConcordProtocol) {
            logPass(`build.protocols: Registrado scheme "concord" para deep-linking`);
        } else {
            logFail(`build.protocols: Scheme "concord" não configurado em build.protocols`);
        }

    } catch (e) {
        logFail(`Erro ao ler package.json: ${e.message}`);
    }
}

// 2. Verificar Assets PNG em client/build/appx
console.log('\n[2/2] Verificando existência e dimensões dos assets PNG em client/build/appx...');

const requiredAssets = [
    { name: 'Square44x44Logo.png', width: 44, height: 44 },
    { name: 'Square150x150Logo.png', width: 150, height: 150 },
    { name: 'StoreLogo.png', width: 50, height: 50 },
    { name: 'LargeTile.png', width: 310, height: 310 },
    { name: 'SmallTile.png', width: 71, height: 71 },
    { name: 'BadgeLogo.png', width: 24, height: 24 },
    { name: 'Wide310x150Logo.png', width: 310, height: 150 },
    { name: 'SplashScreen.png', width: 620, height: 300 }
];

if (!fs.existsSync(appxDir)) {
    logFail(`Diretório de assets AppX não encontrado: ${appxDir}`);
} else {
    for (const asset of requiredAssets) {
        const filePath = path.join(appxDir, asset.name);
        const info = getPngDimensions(filePath);
        if (!info) {
            logFail(`Arquivo ausente: ${asset.name}`);
        } else if (!info.isPng) {
            logFail(`${asset.name} não é um PNG válido`);
        } else if (info.width !== asset.width || info.height !== asset.height) {
            logFail(`${asset.name}: dimensões incorretas! Esperado ${asset.width}x${asset.height}, obtido ${info.width}x${info.height}`);
        } else {
            logPass(`${asset.name} (${info.width}x${info.height}, ${info.size} bytes)`);
        }
    }
}

// Resumo
console.log('\n------------------------------------------------------------');
if (errors === 0) {
    console.log(`\x1b[32m✔ SUCESSO: Todos os ${passed} testes passaram! Configuração AppX/MSIX e assets validados.\x1b[0m`);
    console.log('------------------------------------------------------------\n');
    process.exit(0);
} else {
    console.error(`\x1b[31m✖ FALHA: ${errors} erro(s) encontrado(s) e ${passed} teste(s) passaram.\x1b[0m`);
    console.log('------------------------------------------------------------\n');
    process.exit(1);
}
