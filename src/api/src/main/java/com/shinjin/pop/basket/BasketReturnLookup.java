package com.shinjin.pop.basket;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import synthetic.basket.BasketDomain.*;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/** Fixture adapter for SP_POP_REG_PROCESS3_02_LIST. Each answer is scoped to its terminal and inputs. */
@RestController
@Profile("demo")
@RequestMapping("/api/pop/work-baskets/return-lookup/{date}/{sequence}")
final class BasketReturnLookup {
    record Input(PlanKey firstPlan,Lot firstIssue,Lot focusedIssue,BigDecimal length,String position,DisplayLot row) {}
    record Position(String code,String name) {}
    record Answer(List<String> terminals,String warehouse,String warehouseName,List<Position> positions,List<String> grades,
                  String inputItem,String orderItem,String inputStatus,String orderStatus,String itemKind3,
                  BigDecimal thickness,BigDecimal width,List<Integer> lengths,List<String> materialCodes) {}
    private final BasketDemoController basket;
    private final BasketStockCatalog catalog;
    private final TerminalSettingsDemoController settings;
    private final List<Answer> answers;
    BasketReturnLookup(BasketDemoController basket,BasketStockCatalog catalog,TerminalSettingsDemoController settings,
            @Value("${shinjin.demo.basket-return-lookup:classpath:demo/basket-return-lookup.json}") Resource resource) throws IOException {
        this.basket=basket;this.catalog=catalog;this.settings=settings;
        try(var in=resource.getInputStream()){answers=List.of(JsonMapper.builder().build().readValue(in,Answer[].class));}
    }
    private static ResponseStatusException error(HttpStatus status,String reason){return new ResponseStatusException(status,reason);}
    private static Work work(View v,PlanKey key){return v.work().stream().filter(w->w.plan().key().equals(key)).findFirst()
            .orElseThrow(()->error(HttpStatus.NOT_FOUND,"WORK_NOT_FOUND"));}
    private static BasketStockCatalog.Stock stock(BasketStockCatalog.Site site,Lot key){return site.stocks().stream().filter(s->s.spec().lot().equals(key)).findFirst()
            .orElseThrow(()->error(HttpStatus.UNPROCESSABLE_ENTITY,"ISSUE_NOT_FOUND"));}
    @PostMapping
    List<DisplayLot> lookup(@PathVariable LocalDate date,@PathVariable int sequence,@RequestBody Input in,HttpServletRequest request){
        var v=basket.pickerView(request);var focus=work(v,new PlanKey(date,sequence));var first=work(v,in.firstPlan());
        if(focus.phase()==Phase.COMPLETED || focus.phase()==Phase.PAUSED)throw error(HttpStatus.CONFLICT,"WORK_STATE");
        var site=catalog.site(v.actor().terminal());var cols=focus.plan().columns();
        if(site==null || cols==null)throw error(HttpStatus.NOT_FOUND,"RETURN_CONTEXT");
        var input=stock(site,in.firstIssue());var material=stock(site,in.focusedIssue()).spec();
        String status=site.plans().stream().filter(p->p.key().equals(focus.plan().key())).map(BasketStockCatalog.PlanStatus::status).findFirst().orElse("");
        var roles=settings.pinnedWarehouseRoles(request).map(r->r.getOrDefault("returns",List.of()))
                .orElseGet(()->answers.stream().filter(a->a.terminals().contains(site.terminal())).map(Answer::warehouse).distinct().toList());
        if(roles.isEmpty())throw error(HttpStatus.CONFLICT,"RETURN_WAREHOUSE_REQUIRED");
        String grade=cols.quality(),name=cols.qualityName();
        if("014".equals(grade)||"015".equals(grade)){grade="019";name="S45C";}
        var t=material.thickness();var w=material.width();
        if(t.compareTo(w)==0 && (t.compareTo(BigDecimal.valueOf(7))==0||t.compareTo(BigDecimal.valueOf(3))==0)){t=cols.thickness();w=cols.width();}
        boolean resolve=in.length()!=null;
        if(resolve && (in.length().signum()<=0 || in.length().compareTo(BigDecimal.valueOf(999999))>0))throw error(HttpStatus.BAD_REQUEST,"INVALID_LENGTH");
        if(resolve && in.row()!=null){
            var r=in.row();
            if(r.lot()==null || !Objects.equals(in.position(),r.lot().position()) || !roles.get(0).equals(r.lot().warehouse())
                    || r.thickness()==null || r.width()==null || !basket.recognizesReturn(request,v,focus,r))
                throw error(HttpStatus.UNPROCESSABLE_ENTITY,"RETURN_ROW_CONTEXT");
            t=r.thickness();w=r.width();
            if(r.qualityCode()!=null)grade=r.qualityCode();
            name=r.qualityName();
        }
        List<DisplayLot> result=new ArrayList<>();
        for(var a:answers){
            if(!a.terminals().contains(site.terminal()) || !a.warehouse().equals(roles.get(0)) || !a.grades().contains(grade)
                    || !a.inputItem().equals(input.spec().lot().item()) || !a.orderItem().equals((resolve?focus:first).plan().item())
                    || !a.inputStatus().equals(input.workStatus()) || !a.orderStatus().equals(status)
                    || !a.itemKind3().equals(resolve?Objects.toString(input.itemKind3(),""):"")
                    || a.thickness().compareTo(t)!=0 || a.width().compareTo(w)!=0)continue;
            for(var p:a.positions()){
                if(resolve && !p.code().equals(in.position()))continue;
                String item=resolve && in.row()!=null?in.row().lot().item():"";
                if(resolve && a.lengths().stream().anyMatch(n->in.length().compareTo(BigDecimal.valueOf(n))==0))
                    for(String code:a.materialCodes())item=code; // the native loop retains the last returned material
                String lot=resolve && in.row()!=null?in.row().lot().lot():"";
                var prior=resolve?in.row():null;
                var d=new DisplayLot(new Lot(item,lot,a.warehouse(),p.code()),prior==null?a.warehouseName():prior.warehouseName(),
                        prior==null?p.name():prior.locationName(),name,t,w,resolve?in.length():BigDecimal.ZERO,prior==null?grade:prior.qualityCode());
                result.add(d);
                basket.rememberReturn(request,v.actor(),focus.plan().key(),d);
            }
        }
        return result;
    }
}
