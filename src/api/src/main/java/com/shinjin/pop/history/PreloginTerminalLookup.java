package com.shinjin.pop.history;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Internal scope lookup. Does not expose the worker roster over HTTP. */
public final class PreloginTerminalLookup {
    private PreloginTerminalLookup() {}
    public static java.util.List<String> sameFactory(WorkHistoryFixtures fixtures,String factory) {
        return fixtures.terminals().stream().filter(t->t.factory().equals(factory)).map(WorkHistoryFixtures.Terminal::id).toList();
    }
    public static WorkHistoryFixtures.Terminal require(WorkHistoryFixtures fixtures,String id) {
        return fixtures.terminals().stream().filter(t->t.id().equals(id)).findFirst()
            .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"TERMINAL_SCOPE"));
    }
}