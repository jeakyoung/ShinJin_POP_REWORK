package com.shinjin.pop.workorders;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Mutations are serialized together with the parent work order by WorkOrderFixtures. */
public final class WorkDefects {
    public record Line(String code,BigDecimal quantity) {}
    public record Command(String requestId,long revision,String warehouse,String location,List<Line> lines) {}
    public record Detail(String code,BigDecimal quantity,String createdBy,Instant createdAt,String updatedBy,Instant updatedAt) {}
    public record Saved(String warehouse,String location,List<Detail> lines,BigDecimal total) {}
    public record View(long revision,List<String> warehouses,Map<String,List<String>> locations,List<ProductionCatalog.Reason> reasons,Saved saved) {}
    public record Receipt(String key,String worker,Command command,View view) {}
    static final Saved EMPTY=new Saved(null,null,List.of(),BigDecimal.ZERO);
    private final Map<String,Saved> saved=new HashMap<>();
    private final Map<String,Receipt> receipts=new HashMap<>();
    public Saved get(String key){return saved.getOrDefault(key,EMPTY);}
    void clear(String key){saved.remove(key);}
    public View view(String key,long revision,ProductionCatalog.Terminal cfg) {
        var locations=new LinkedHashMap<String,List<String>>();
        cfg.bad().forEach(warehouse->locations.put(warehouse,cfg.locations().getOrDefault(warehouse,List.of())));
        return new View(revision,cfg.bad(),Map.copyOf(locations),cfg.reasons(),get(key));
    }
    public View replay(String key,String worker,Command cmd) {
        if(cmd==null || cmd.requestId()==null || cmd.requestId().isBlank() || cmd.requestId().length()>128)throw new IllegalArgumentException("INVALID_COMMAND");
        var previous=receipts.get(cmd.requestId());
        if(previous==null)return null;
        if(!previous.key().equals(key)||!previous.worker().equals(worker)||!previous.command().equals(cmd))throw new IllegalStateException("REQUEST_ID_REUSED");
        return previous.view();
    }
    public View apply(String key,String worker,Command cmd,ProductionCatalog.Terminal cfg) {
        if(cmd.warehouse()==null || cmd.location()==null || !cfg.bad().contains(cmd.warehouse()) || !cfg.locations().getOrDefault(cmd.warehouse(),List.of()).contains(cmd.location()))throw new IllegalArgumentException("BAD_LOCATION_REQUIRED");
        if(cmd.lines()==null || cmd.lines().size()>cfg.reasons().size())throw new IllegalArgumentException("INVALID_DEFECT_LINES");
        var known=cfg.reasons().stream().map(ProductionCatalog.Reason::code).toList();
        var prior=get(key);var lines=new LinkedHashMap<String,Detail>();var seen=new java.util.HashSet<String>();
        var now=Instant.now();var total=BigDecimal.ZERO;
        for(var line:cmd.lines()){
            if(line==null || !known.contains(line.code()) || !seen.add(line.code()) || line.quantity()==null
               || line.quantity().signum()<0 || line.quantity().stripTrailingZeros().scale()>0)throw new IllegalArgumentException("INVALID_DEFECT_LINES");
            if(line.quantity().signum()==0)continue;
            var old=prior.lines().stream().filter(row->row.code().equals(line.code())).findFirst().orElse(null);
            lines.put(line.code(),new Detail(line.code(),line.quantity(),old==null?worker:old.createdBy(),old==null?now:old.createdAt(),worker,now));
            total=total.add(line.quantity());
        }
        saved.put(key,new Saved(cmd.warehouse(),cmd.location(),List.copyOf(lines.values()),total));
        var result=view(key,cmd.revision()+1,cfg);
        receipts.put(cmd.requestId(),new Receipt(key,worker,cmd,result));
        return result;
    }
}
