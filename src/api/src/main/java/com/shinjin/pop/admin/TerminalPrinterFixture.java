package com.shinjin.pop.admin;

import java.util.List;

final class TerminalPrinterFixture {
    static List<String> forTerminal(String terminal) {
        return switch(terminal) {
            case "DEMO-A" -> registered("A");
            case "DEMO-A2" -> registered("A2");
            case "DEMO-B" -> registered("B");
            default -> List.of();
        };
    }
    static List<String> registered(String terminalPrefix) {
        return List.of(terminalPrefix + "-DOC", terminalPrefix + "-DOC2",
                terminalPrefix + "-SHIP", terminalPrefix + "-LABEL");
    }

    private TerminalPrinterFixture() {}
}
