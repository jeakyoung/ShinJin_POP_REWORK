package com.shinjin.pop.workprint;

import java.util.*;
import static com.shinjin.pop.workprint.WorkPrintData.*;

/** ComOrderNoScan's first date, distinct plan sequences and group's dependent rows. */
public class WorkPrintRemovalCheck {
    static final String FACTORY="TEST-F",PLANT="TEST-P",NO="WPTEST000001";
    static Link row(String table,String order,String day,String seq,String group,String ship) {
        return new Link(table,FACTORY,PLANT,order,day,seq,group,ship);
    }
    public static void main(String[] args) {
        var plans=List.of(row("TPR301",NO,"day1","1","",""),row("TPR301",NO,"day2","2","",""));
        var result=row("TPR601",NO,"day1","1","group1","");
        var pack=row("TSA407",NO,"day1","1","","ship1");
        var sharedMaterial=row("TPR601M","OTHER","day2","90","group1","");
        var sharedPackLine=row("TSA407L","OTHER","day2","90","","ship1");
        var otherLot=row("TPR601LOT","OTHER","day2","90","group1","");
        var otherGroup=row("TPR601T","OTHER","day1","1","group2","");
        var sale=row("TSA308",NO,"day2","2","","");
        var foreign=new Link("TPR601M",FACTORY,"OTHER-PLANT",NO,"day1","1","group1","");
        var links=new ArrayList<>(plans);
        links.addAll(List.of(result,pack,sharedMaterial,sharedPackLine,otherLot,otherGroup,sale,foreign));
        var f=new Fixture("synthetic",List.of(),List.of(),List.of(),List.of(),links);
        var data=new WorkPrintData(f);
        var removal=data.scan(FACTORY,PLANT,NO+"9999");
        if(!removal.performance() || !removal.links().equals(Set.of(plans.get(0),result,pack,sharedMaterial,sharedPackLine,sale)))
            throw new AssertionError(removal);
        if (!data.links.equals(links)) throw new AssertionError("Scan changed rows");
        System.out.println("PASS date/seq vs group vs order vs ship scope; other plant and unconfirmed rows preserved");
    }
}
