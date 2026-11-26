package com.shinjin.pop.history;

import com.shinjin.pop.admin.PreloginDetailStore;
import com.shinjin.pop.admin.PreloginSiteScope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Profile("demo")
@RestController
public final class PreloginSettings {
    private static final Set<String> FILES = Set.of("ftp", "db", "printer", "plant", "process", "machine", "warehouse", "popId", "group", "material");
    private final WorkHistoryFixtures fixtures;
    private final PreloginDetailStore store;
    private final PreloginSiteScope sites;
    private final boolean test;
    private final String terminalId;
    private final List<String> missing;
    private final String version;
    private final List<String> emptyAddresses;

    public record Status(String terminalId, boolean groupCenter, List<String> missing, boolean ready, String version,
                         boolean ftpAddressPresent, boolean dbAddressPresent) {}

    public PreloginSettings(WorkHistoryFixtures fixtures,PreloginDetailStore store,PreloginSiteScope sites,Environment environment) {
        this.fixtures = fixtures;
        this.store=store; this.sites=sites;
        test = environment.matchesProfiles("prelogin-test");
        var first = fixtures.terminals().stream().findFirst().orElseThrow().id();
        terminalId = test ? environment.getProperty("shinjin.prelogin.terminal", first) : first;
        if (fixtures.terminals().stream().noneMatch(t -> t.id().equals(terminalId))) throw new IllegalArgumentException("Unknown test terminal");
        String omissions = test ? environment.getProperty("shinjin.prelogin.missing", "") : "";
        missing = omissions.isBlank() ? List.of() : Arrays.stream(omissions.split(",")).map(String::strip).distinct().toList();
        if (!FILES.containsAll(missing)) throw new IllegalArgumentException("Unknown test setting");
        String empty = test ? environment.getProperty("shinjin.prelogin.empty-address", "") : "";
        emptyAddresses = empty.isBlank() ? List.of() : Arrays.stream(empty.split(",")).map(String::strip).distinct().toList();
        if (!Set.of("ftp", "db").containsAll(emptyAddresses)) throw new IllegalArgumentException("Unknown fixture address");
        version = test ? environment.getProperty("shinjin.prelogin.version", "") : "";
        if (!version.isEmpty() && !version.matches("[0-9]+(\\.[0-9]+){0,3}")) throw new IllegalArgumentException("Invalid fixture version");
    }
    public record TerminalChoice(String id,String name) {}

    @GetMapping("/api/pop/prelogin-settings/terminals")
    public ResponseEntity<List<TerminalChoice>> terminals() {
        var choices = fixtures.terminals().stream().filter(t->!test || terminalId.equals(t.id()))
                .map(t->new TerminalChoice(t.id(),t.name())).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(choices);
    }

    public Status effective(String selected,HttpServletRequest request) {
        if (test && !terminalId.equals(selected)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        var site=sites.site(selected,request);
        var absent=new java.util.LinkedHashSet<>(missing);
        var global=store.savedFlags(selected,"","",request);
        var local=store.savedFlags(selected,site.plant(),site.center(),request);
        if(global.sections().contains("plant")) {
            absent.remove("plant");
            absent.addAll(List.of("process","machine","popId","material","warehouse","group"));
        }
        if(global.sections().contains("printer")) absent.remove("printer");
        if(local.pin().slots()!=null) {
            absent.remove("process"); absent.add("machine"); absent.add("popId"); absent.add("material");
        }
        if(Boolean.TRUE.equals(local.machineReady()) || local.sections().contains("machine")) absent.remove("machine");
        if(local.sections().contains("popId")) absent.remove("popId");
        if(local.sections().contains("group")) {
            if(com.shinjin.pop.admin.PreloginGroupState.assigned(store,selected,site.plant(),site.center(),request).isPresent()) absent.remove("group");
            // Registry edits leave the existing group INI presence unchanged until assignment.
        }
        if(local.pin().materials()!=null) {
            if(local.pin().materials().isEmpty()) absent.add("material"); else absent.remove("material");
        }
        if(local.pin().warehouses()!=null) absent.remove("warehouse");
        boolean group=!absent.contains("plant") && Set.of("005","105").contains(site.center());
        var info=store.local(selected,"","","info",tools.jackson.databind.JsonNode.class,request);
        if(info.isPresent()) {absent.remove("ftp");absent.remove("db");}
        boolean ftp=info.map(n->!n.path("ftpHost").asString("").isBlank()).orElse(!absent.contains("ftp") && !emptyAddresses.contains("ftp"));
        boolean db=info.map(n->!n.path("dbHost").asString("").isBlank()).orElse(!absent.contains("db") && !emptyAddresses.contains("db"));
        var displayVersion=info.map(n->n.path("version").asString("")).orElse(version);
        boolean ready=absent.stream().allMatch(key -> key.equals("material") || (key.equals("group") && !group));
        return new Status(selected,group,List.copyOf(absent),ready,ftp ? displayVersion : "",ftp,db);
    }
    @GetMapping("/api/pop/prelogin-settings")
    public ResponseEntity<Status> read(@org.springframework.web.bind.annotation.RequestParam(required=false) String terminalId,HttpServletRequest request,HttpServletResponse response) {
        store.initializeBrowser(request,response);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(effective(terminalId==null ? this.terminalId : terminalId,request));
    }
    void checkLogin(String requestedTerminal,HttpServletRequest request) {
        if (!effective(requestedTerminal,request).ready())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "SETTINGS_REQUIRED");
    }
}
