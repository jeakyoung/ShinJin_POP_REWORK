package com.shinjin.pop.basket;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import synthetic.basket.BasketDomain.*;
import tools.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.*;

@Component
@Profile("demo")
final class BasketStockCatalog {
    record Place(String code,String name) {}
    record Location(String warehouse,String raw,Place location) {}
    record PlanStatus(PlanKey key,String status) {}
    record Match(String division,String warehouse,String grades,String status,BigDecimal thickness,BigDecimal width,BigDecimal length,List<Lot> lots) {}
    record Stock(DisplayLot spec,String itemName,String workStatus,BigDecimal stock,String itemKind3) {}
    record Site(String terminal,String plant,List<Place> issue,List<Place> auxiliary,List<Location> locations,List<PlanStatus> plans,List<Stock> stocks,List<Match> answers) {}
    record Candidate(String warehouse,String location,String lot,String material,String name,String quality,BigDecimal thickness,
                     BigDecimal width,BigDecimal length,BigDecimal available,String workStatus,String warehouseName,String locationName) {}

    private final Map<String,Site> sites;
    BasketStockCatalog(@Value("${shinjin.demo.basket-stock-picker:classpath:demo/basket-stock-picker.json}") Resource data) throws IOException {
        try(var in=data.getInputStream()){
            sites=Arrays.stream(JsonMapper.builder().build().readValue(in,Site[].class))
                    .collect(java.util.stream.Collectors.toUnmodifiableMap(Site::terminal,s->s));
        }
    }
    Site site(String terminal){return sites.get(terminal);}
    Map<Lot,BigDecimal> inventory(String terminal,Map<Lot,BigDecimal> defaults) {
        var rows=new HashMap<>(defaults);
        var site=site(terminal);
        if(site!=null)site.stocks().forEach(stock->rows.put(stock.spec().lot(),stock.stock()));
        return rows;
    }
    List<Candidate> query(Site site,View view,String division,String warehouse,String grade,String status,
                          BigDecimal thickness,BigDecimal width,BigDecimal length) {
        var lots=site.answers().stream().filter(answer->answer.division().equals(division) && answer.warehouse().equals(warehouse)
                && answer.grades().equals(grade) && answer.status().equals(status) && answer.thickness().compareTo(thickness)==0
                && answer.width().compareTo(width)==0 && answer.length().compareTo(length)==0).flatMap(answer->answer.lots().stream()).toList();
        List<Candidate> found=new ArrayList<>();
        for(var lot:lots){
            var spec=site.stocks().stream().filter(stock->stock.spec().lot().equals(lot)).findFirst().orElse(null);
            var available=view.materials().stream().filter(stock->stock.lot().equals(lot)).findFirst().orElse(null);
            if(spec==null || available==null || available.available().signum()<=0)continue;
            var d=spec.spec();
            found.add(new Candidate(lot.warehouse(),lot.position(),lot.lot(),lot.item(),spec.itemName(),d.qualityName(),
                    d.thickness(),d.width(),d.length(),available.available(),spec.workStatus(),d.warehouseName(),d.locationName()));
        }
        return found;
    }
}
