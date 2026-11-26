package com.shinjin.pop.planning;

import com.shinjin.pop.history.DemoSessionController;
import com.shinjin.pop.processgroup.ProcessGroupController;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import synthetic.planning.PlanningDomain.Actor;
import tools.jackson.databind.json.JsonMapper;
import static com.shinjin.pop.planning.ProcessPlanController.*;

@Component
@Profile("demo")
public final class ProcessPlanCatalog {
    private final Catalog config;
    private final ProcessGroupController groups;

    public ProcessPlanCatalog(@Value("${shinjin.demo.process1-planning:classpath:demo/process1-planning.json}") Resource file,
                              ProcessGroupController groups) throws IOException {
        this.groups = groups;
        try(var in=file.getInputStream()){config=JsonMapper.builder().build().readValue(in,Catalog.class);}
    }

    SiteCatalog site(Actor actor) {
        return config.sites().stream().filter(s -> s.site().equals(actor.site().site())).findFirst().orElse(null);
    }

    SiteCatalog selectedSite(Actor actor,HttpServletRequest request) {
        var cfg=site(actor);
        String selected=request.getHeader("X-Pop-Work-Code");
        if(cfg==null || selected==null)return cfg;
        var identity=DemoSessionController.requireIdentity(request);
        if(!selected.isEmpty() && !identity.workCodes().containsValue(selected)) {
            if (!identity.groupWork()) return null;
            var stages = groups.find(request, null).setting().stages();
            if (stages.isEmpty() || !selected.equals(stages.get(0).processCode())) return null;
        }
        return new SiteCatalog(cfg.site(),cfg.date(),cfg.plantCode(),selected,cfg.process(),cfg.warehouses(),
                cfg.qualities(),cfg.stock(),cfg.orders(),cfg.scans());
    }

    public boolean completionPrintAvailable(HttpServletRequest request) {
        var cfg=selectedSite(PlanningDemoController.actor(request),request);
        if(cfg==null)return false;
        return switch(cfg.plantCode()) {
            case "000001" -> Set.of("001","003","004","006").contains(cfg.workCode());
            case "000002" -> "001".equals(cfg.workCode());
            default -> false;
        };
    }
}
