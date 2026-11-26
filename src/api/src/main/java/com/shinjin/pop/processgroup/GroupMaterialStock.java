package com.shinjin.pop.processgroup;

import java.math.BigDecimal;
import java.util.*;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
@Profile("demo")
public final class GroupMaterialStock {
    public record Stock(String warehouse,String location,String lot,String material,String name,String quality,
                        BigDecimal thickness,BigDecimal width,BigDecimal length,int available,String workStatus) {}
    record Site(String terminal,String factory,String plant,String center,String warehouseStatus,List<Stock> rows) {}
    record Data(List<Site> sites) {}
    public record Pick(Stock stock,int quantity) {}
    public record Addition(String lot,String warehouse,String location,String material,BigDecimal quantity) {}
    public record Scan(String raw) {}
    private final List<Site> sites;
    public GroupMaterialStock(@Value("${shinjin.demo.group-material:classpath:demo/group-material.json}") Resource file) throws IOException {
        try(var stream=file.getInputStream()){sites=JsonMapper.builder().build().readValue(stream,Data.class).sites();}
    }
    List<Stock> lookup(String terminal,String factory,String plant,String center,List<String> issue,
                       String code,GroupReturnCatalog.Material spec,String lot) {
        if(spec==null)return List.of();
        return sites.stream().filter(s->s.terminal().equals(terminal)&&s.factory().equals(factory)&&s.plant().equals(plant)&&s.center().equals(center))
            .flatMap(s->{
                var status=switch(code){case "001","002" -> "W";case "003" -> s.warehouseStatus()+"C";case "004" -> s.warehouseStatus()+"H";default -> "";};
                return s.rows().stream().filter(row->row.workStatus().equals(status));
            }).filter(row->row.lot().equals(lot)&&row.available()>0&&issue.contains(row.warehouse())&&row.quality().equals(spec.grade())
                &&row.thickness().compareTo(spec.thickness())==0&&row.width().compareTo(spec.width())==0).toList();
    }
}
