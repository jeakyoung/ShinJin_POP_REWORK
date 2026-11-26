package com.shinjin.pop.drawing;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.HashMap;
import java.util.HashSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import synthetic.drawing.DrawingDomain.GoodPlace;
import synthetic.drawing.DrawingDomain.PlanKey;
import synthetic.drawing.DrawingDomain.Session;
import synthetic.drawing.DrawingDomain.Snapshot;
import tools.jackson.databind.json.JsonMapper;

@Component
@Profile("demo")
final class DrawingGoodPlaces {
    record Codes(String warehouse, String location) {}
    record Selection(String key, long version, Codes opening, Codes selected) {}
    private record RecordKey(String terminal, PlanKey plan) {}
    private record Choices(long version, Set<Codes> values) {}
    private static final class Drafts { final Map<RecordKey,Choices> rows = new HashMap<>(); }
    record Warehouse(String code, String name, String status, String etc, List<DrawingReturnPlaces.Choice> locations) {}
    record Order(String status, Codes initial) {}
    record Site(List<Warehouse> warehouses, Map<String,Order> orders) {}
    record Source(Map<String,Site> sites) {}
    record Options(List<Warehouse> warehouses, GoodPlace initial) {}
    private static final Site EMPTY = new Site(List.of(), Map.of());
    private static final Set<String> SUFFIXES = Set.of("C", "H", "Z", "G");
    private final Source source;
    private final TerminalSettingsDemoController settings;

    DrawingGoodPlaces(@Value("${shinjin.demo.drawing-good-places:classpath:demo/drawing-good-places.json}") Resource resource,
                      TerminalSettingsDemoController settings) throws IOException {
        this.settings = settings;
        try (var stream = resource.getInputStream()) {
            source = JsonMapper.builder().build().readValue(stream, Source.class);
        }
    }

    Options options(Session actor, PlanKey key, HttpServletRequest request) {
        var site = source.sites().getOrDefault(actor.factory() + "/" + actor.site(), EMPTY);
        var order = site.orders().get(key.date() + "/" + key.sequence());
        var configured = settings.pinnedWarehouseRoles(request);
        var warehouses = site.warehouses().stream()
                .filter(w -> configured.isEmpty() || configured.get().getOrDefault("good",List.of()).contains(w.code()))
                .map(w -> new Warehouse(w.code(), w.name(), order != null && SUFFIXES.contains(w.status())
                        ? order.status() + w.status() : w.status(), w.etc(), w.locations())).toList();
        return new Options(warehouses, order == null ? null : find(warehouses,order.initial(),false));
    }

    synchronized GoodPlace resolve(Session actor, PlanKey key, Snapshot snapshot, Codes codes, HttpServletRequest request) {
        if (codes == null) return null;
        if (key == null || !actor.factory().equals(key.factory()) || !actor.site().equals(key.site()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"PLAN_OUT_OF_SCOPE");
        var previous = drafts(request).rows.get(new RecordKey(actor.terminal(),key));
        boolean retained = snapshot != null && (codes.equals(codes(snapshot.goodPlace()))
                || (previous != null && previous.version()==snapshot.version() && previous.values().contains(codes)));
        var place = find(options(actor,key,request).warehouses(),codes,retained);
        if (place == null) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_GOOD_PLACE");
        return place;
    }

    synchronized GoodPlace select(Session actor, PlanKey key, Snapshot snapshot, Selection selection, HttpServletRequest request) {
        if (snapshot.version()!=selection.version()) throw new ResponseStatusException(HttpStatus.CONFLICT,"STALE_VERSION");
        var options = options(actor,key,request);
        var current = snapshot.goodPlace()==null ? options.initial() : snapshot.goodPlace();
        var recordKey = new RecordKey(actor.terminal(),key);
        var drafts = drafts(request);
        var seen = drafts.rows.compute(recordKey,(ignored,old) -> old!=null && old.version()==snapshot.version()
                ? old : new Choices(snapshot.version(),new HashSet<>()));
        var from=selection.opening(); var to=selection.selected();
        boolean retained=from!=null && to!=null && java.util.Objects.equals(from.location(),to.location())
                && (from.equals(codes(current)) || seen.values().contains(from));
        var place=find(options.warehouses(),to,retained);
        if(place==null) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_GOOD_PLACE");
        seen.values().add(to);
        return place;
    }

    private static Codes codes(GoodPlace place) {
        return place==null ? null : new Codes(place.warehouse(),place.location());
    }

    private static Drafts drafts(HttpServletRequest request) {
        var session=request.getSession(false);
        var key=DrawingGoodPlaces.class.getName();
        var drafts=(Drafts)session.getAttribute(key);
        if(drafts==null) { drafts=new Drafts(); session.setAttribute(key,drafts); }
        return drafts;
    }

    private static GoodPlace find(List<Warehouse> warehouses, Codes codes, boolean retained) {
        if (codes == null || codes.location()==null || codes.location().isBlank()) return null;
        for (var wh : warehouses) {
            if (wh.code().equals(codes.warehouse())) {
                var location=wh.locations().stream().filter(loc -> loc.code().equals(codes.location())).findFirst();
                if(location.isPresent() || retained)
                    return new GoodPlace(wh.code(),wh.name(),codes.location(),location.map(DrawingReturnPlaces.Choice::name).orElse(""),wh.status(),wh.etc());
            }
        }
        return null;
    }
}
