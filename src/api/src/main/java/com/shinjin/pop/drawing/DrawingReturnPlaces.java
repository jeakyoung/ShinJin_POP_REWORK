package com.shinjin.pop.drawing;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import synthetic.drawing.DrawingDomain.MaterialReturn;
import synthetic.drawing.DrawingDomain.Session;
import tools.jackson.databind.json.JsonMapper;

@Profile("demo")
@Component
final class DrawingReturnPlaces {
    record Choice(String code, String name) {}
    record Warehouse(String code, String name, List<Choice> locations) {}
    record Result(String material, String quality, String warehouse, String inputItem,
                  BigDecimal thickness, BigDecimal width, BigDecimal length) {}
    record ScrapMaster(String quality,String material,String warehouse,String location,int thickness,int width,int length) {}
    record Site(List<Warehouse> warehouses,List<Result> results,List<ScrapMaster> scrapMasters) {}
    List<ScrapMaster> scrapMasters(Session actor,String quality) {
        var rows=site(actor).scrapMasters();
        return rows==null?List.of():rows.stream().filter(row->row.quality().equals(quality) && "013".equals(row.warehouse())
                && row.thickness()>=0 && row.thickness()<=1 && row.width()>=0 && row.width()<=1
                && row.length()>=0 && row.length()<=1).toList();
    }
    record Source(Map<String, Site> sites) {}
    private static final Site EMPTY = new Site(List.of(), List.of(),List.of());
    private final Source source;
    private final TerminalSettingsDemoController settings;

    DrawingReturnPlaces(TerminalSettingsDemoController settings,
            @Value("${shinjin.demo.drawing-return-places:classpath:demo/drawing-return-places.json}") Resource resource)
            throws IOException {
        this.settings = settings;
        try (var stream = resource.getInputStream()) {
            source = JsonMapper.builder().build().readValue(stream, Source.class);
        }
    }

    private Site site(Session actor) {
        return source.sites().getOrDefault(actor.factory() + "/" + actor.site(), EMPTY);
    }

    List<Warehouse> choices(Session actor, HttpServletRequest request) {
        var rows = site(actor).warehouses();
        return settings.pinnedWarehouseRoles(request).map(roles -> roles.getOrDefault("returns", List.of())
                .stream().flatMap(code -> rows.stream().filter(row -> row.code().equals(code))).toList()).orElse(rows);
    }

    static boolean contains(List<Warehouse> warehouses, String warehouse, String location) {
        return warehouses.stream().anyMatch(row -> row.code().equals(warehouse) &&
                row.locations().stream().anyMatch(place -> place.code().equals(location)));
    }

    String lookup(Session actor, String quality, String warehouse, String item, MaterialReturn spec) {
        return site(actor).results().stream().filter(r -> r.quality().equals(quality)
                && r.warehouse().equals(warehouse) && r.inputItem().equals(item) && sameDimensions(r,spec))
                .map(Result::material).reduce((first, last) -> last).orElse("");
    }

    boolean isScrapMaster(Session actor,String grade,MaterialReturn line) {
        return "013".equals(line.warehouse()) && scrapMasters(actor,grade).stream().anyMatch(r->
                r.material().equals(line.material()) && (line.location()==null || line.location().isBlank() || r.location().equals(line.location())) && r.thickness()==1 && r.width()==1 && r.length()==1
                        && BigDecimal.ONE.equals(line.thickness()==null?null:line.thickness().stripTrailingZeros())
                        && BigDecimal.ONE.equals(line.width()==null?null:line.width().stripTrailingZeros())
                        && BigDecimal.ONE.equals(line.length()==null?null:line.length().stripTrailingZeros()));
    }

    boolean matchesResolvedMaterial(Session actor, String quality, MaterialReturn line) {
        return site(actor).results().stream().anyMatch(r -> r.quality().equals(quality) && r.warehouse().equals(line.warehouse())
                && r.material().equals(line.material()) && sameDimensions(r,line));
    }

    private static boolean sameDimensions(Result result, MaterialReturn line) {
        return line.thickness() != null && line.width() != null && line.length() != null
                && result.thickness().compareTo(line.thickness()) == 0 && result.width().compareTo(line.width()) == 0
                && result.length().compareTo(line.length()) == 0;
    }
}
